/* MISO — restaurant configuration.
   Everything an owner is likely to change lives here. */

window.MISO_CONFIG = {
  restaurant: {
    name: "MISO",
    longName: "MISO Japanese & Thai Restaurant",
    shortDescription:
      "Japanese precision and Thai fire on a rooftop in Maitama, Abuja.",
    address: {
      line1: "Rooftop, Summerset Continental Hotel",
      line2: "34 Usuma Street, Maitama",
      city: "Abuja 900271",
      country: "Nigeria"
    },
    phoneDisplay: "+234 702 523 6666",
    phone: "+2347025236666",
    instagramHandle: "@misorestaurantabuja",
    instagram: "https://instagram.com/misorestaurantabuja",
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=Summerset+Continental+Hotel+34+Usuma+Street+Maitama+Abuja",
    hours: [
      { days: "Monday – Sunday", time: "10:30am – late" }
    ],
    hoursNote:
      "Kitchen closes before the restaurant. For a late table, call ahead and we will look after you.",
    priceRange: "₦₦₦"
  },

  /* Both roles use the restaurant line, so checkout shows one combined WhatsApp
     button. Give the chef a separate number here to split the handoff in two. */
  whatsapp: {
    waiter: "2347025236666",
    chef: "2347025236666"
  },

  /* Real account. Set preview to true only when showing demo details, which
     brings back the "not live" warning at checkout. */
  bank: {
    preview: false,
    bankName: "Moniepoint",
    accountName: "Miso Japanese and Thai Restaurant",
    accountNumber: "5945221845"
  },

  /* Tax charged on the food subtotal at checkout. Delivery is not taxed. */
  tax: {
    rate: 0.1
  },

  /* Delivery is ride-hailed with Bolt, so there is no fixed fee: both zones
     show "quoted on WhatsApp" at checkout and the fare is confirmed per trip.
     Set a numeric fee only if the restaurant starts charging a flat rate. */
  delivery: {
    maitama: {
      label: "Maitama",
      fee: null,
      note: "Ride-hailed with Bolt; we quote the fare on WhatsApp before dispatch."
    },
    abuja: {
      label: "Elsewhere in Abuja",
      fee: null,
      note: "Ride-hailed with Bolt; we quote the fare on WhatsApp before dispatch."
    }
  },

  pickup: {
    slots: [
      "As soon as possible (30–40 minutes)",
      "In 1 hour",
      "In 1½ hours",
      "In 2 hours"
    ],
    note: "We will confirm the exact time on WhatsApp."
  },

  currency: {
    code: "NGN",
    symbol: "₦"
  },

  order: {
    prefix: "MISO",
    cartKey: "miso-cart-v1",
    lastOrderKey: "miso-last-order-v1",
    maxQuantity: 20
  }
};
