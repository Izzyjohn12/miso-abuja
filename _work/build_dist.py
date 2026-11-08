"""Build a clean deploy folder (dist/) plus the upload zip from the same files."""
import os
import shutil
import zipfile

ROOT = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0"
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(ROOT, "MISO-website.zip")

if os.path.isdir(DIST):
    shutil.rmtree(DIST)
os.makedirs(DIST)

shutil.copy2(os.path.join(ROOT, "index.html"), os.path.join(DIST, "index.html"))
shutil.copy2(os.path.join(ROOT, "manifest.webmanifest"), os.path.join(DIST, "manifest.webmanifest"))
shutil.copy2(os.path.join(ROOT, "sw.js"), os.path.join(DIST, "sw.js"))
shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(DIST, "assets"))

STAFF = os.path.join(ROOT, "staff")
if os.path.isdir(STAFF):
    shutil.copytree(STAFF, os.path.join(DIST, "staff"))

# Only /api/* is handled by Pages Functions. Everything else is served from
# the static build, including /staff/ once it exists.
with open(os.path.join(DIST, "_routes.json"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write('{\n  "version": 1,\n  "include": ["/api/*"],\n  "exclude": []\n}\n')

# Cloudflare Pages headers. The guest site is indexable now that the
# restaurant approved it; the staff console and API stay out of search.
with open(os.path.join(DIST, "_headers"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write(
        "/*\n"
        "  X-Content-Type-Options: nosniff\n"
        "  Referrer-Policy: strict-origin-when-cross-origin\n"
        "  X-Frame-Options: SAMEORIGIN\n"
        "  Permissions-Policy: geolocation=(), microphone=(), camera=()\n"
        "\n"
        "/manifest.webmanifest\n"
        "  Content-Type: application/manifest+json\n"
        "  Cache-Control: public, max-age=3600\n"
        "\n"
        "/sw.js\n"
        "  Content-Type: application/javascript; charset=utf-8\n"
        "  Cache-Control: no-cache\n"
        "\n"
        "/assets/img/app/*\n"
        "  Cache-Control: public, max-age=604800\n"
        "\n"
        "/api/*\n"
        "  Cache-Control: no-store\n"
        "  X-Robots-Tag: noindex, nofollow\n"
        "\n"
        "/staff\n"
        "  Cache-Control: no-cache\n"
        "  X-Robots-Tag: noindex, nofollow\n"
        "\n"
        "/staff/manifest.webmanifest\n"
        "  Content-Type: application/manifest+json\n"
        "  Cache-Control: no-cache\n"
        "  X-Robots-Tag: noindex, nofollow\n"
        "\n"
        "/staff/*\n"
        "  Cache-Control: no-cache\n"
        "  X-Robots-Tag: noindex, nofollow\n"
    )

files = []
for folder, _, names in os.walk(DIST):
    for name in names:
        files.append(os.path.relpath(os.path.join(folder, name), DIST))

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in files:
        z.write(os.path.join(DIST, rel), rel.replace(os.sep, "/"))

print(len(files), "files ->", DIST)
print(round(os.path.getsize(OUT) / 1048576, 2), "MB zip")
