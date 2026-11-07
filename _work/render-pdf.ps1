$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
})[0]

function AwaitAction($WinRtAction) {
    $netTask = $asTaskAction.Invoke($null, @($WinRtAction))
    $netTask.Wait(-1) | Out-Null
}

[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime] | Out-Null

$pdfPath = 'C:\Users\Israel Agaji\OneDrive\Pictures\Camera Roll\Miso Food menu.pdf'
$outDir = 'C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0\_work\pages'

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($pdfPath)) ([Windows.Storage.StorageFile])
$pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
Write-Output "Pages: $($pdf.PageCount)"

for ($i = 0; $i -lt $pdf.PageCount; $i++) {
    $page = $pdf.GetPage($i)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $width = 1800
    $opts.DestinationWidth = [uint32]$width
    $opts.DestinationHeight = [uint32][math]::Round($page.Size.Height * $width / $page.Size.Width)
    AwaitAction ($page.RenderToStreamAsync($stream, $opts))
    $stream.Seek(0)
    $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $outPath = Join-Path $outDir ("page_{0:D2}.png" -f ($i + 1))
    $fileStream = [System.IO.File]::Create($outPath)
    $netStream.CopyTo($fileStream)
    $fileStream.Dispose()
    $netStream.Dispose()
    $stream.Dispose()
    $page.Dispose()
    Write-Output "Rendered $outPath"
}
