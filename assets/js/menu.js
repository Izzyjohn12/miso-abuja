/* MISO menu — single source of truth.
   Prices are in naira and follow the restaurant's printed menu.
   Items with a null price are marked "Ask" and hand off to WhatsApp. */

window.MISO_MENU = [
  {
    id: "japanese",
    name: "Japanese",
    kicker: "Sushi · Tempura · Teriyaki",
    blurb:
      "Precision, clean cuts and quiet detail. Sushi from our counter, crisp tempura, and teriyaki glazed to order.",
    image: "sushi",
    groups: [
      {
        name: "Small plates",
        items: [
          {
            id: "ebi-fry",
            name: "Ebi Fry",
            desc: "Crumb-fried prawns with spicy mayo.",
            price: 28600,
            tags: ["shellfish", "spicy"]
          },
          {
            id: "ebi-tempura",
            name: "Ebi Tempura",
            desc: "Crisp prawns with tempura sauce.",
            price: 28600,
            tags: ["shellfish"]
          },
          {
            id: "seafood-tempura",
            name: "Seafood Tempura",
            desc: "Fish fillet, prawns and cuttlefish with tempura sauce, wasabi and ginger.",
            price: 33000,
            tags: ["shellfish"]
          },
          {
            id: "vegetable-tempura",
            name: "Vegetable Tempura",
            desc: "Beans, carrot, brinjal, onion rings and bell pepper with tempura sauce.",
            price: 21450,
            tags: ["veg"]
          }
        ]
      },
      {
        name: "Sushi & nigiri",
        items: [
          {
            id: "volcano-roll",
            name: "Volcano Roll",
            desc: "Tempura prawns, cucumber and bell pepper with spicy mayo, finished with volcano salad.",
            price: 28600,
            tags: ["shellfish", "spicy"]
          },
          {
            id: "tempura-prawn-maki",
            name: "Tempura Prawn Maki",
            desc: "Tempura prawns, cucumber, bell pepper and avocado.",
            price: 28600,
            tags: ["shellfish"]
          },
          {
            id: "spicy-salmon-roll",
            name: "Spicy Salmon Roll",
            desc: "Salmon, cucumber and avocado with wasabi, soy and ginger pickle.",
            price: 38460,
            tags: ["spicy"]
          },
          {
            id: "california-roll",
            name: "California Roll",
            desc: "Crab stick, cucumber, avocado, lettuce and sriracha sauce.",
            price: 28600,
            tags: ["shellfish", "spicy"]
          },
          {
            id: "crazy-chicken-red-roll",
            name: "Crazy Chicken Red Roll",
            desc: "Eight pieces. Chicken, cucumber and mozzarella in seasoned rice, fried with a crunchy wasabi nori crust.",
            price: 28600,
            tags: []
          },
          {
            id: "salmon-nigiri",
            name: "Salmon Nigiri",
            desc: "Eight pieces of salmon nigiri with wasabi and seasoned rice.",
            price: 36300,
            tags: []
          },
          {
            id: "vegetable-maki",
            name: "Vegetable Maki",
            desc: "Carrot, cucumber, bell pepper, avocado and lettuce with spicy mayo.",
            price: 19500,
            tags: ["veg", "spicy"]
          }
        ]
      },
      {
        name: "Soups & salads",
        items: [
          {
            id: "miso-shiro",
            name: "Miso Shiro Soup",
            desc: "White miso broth with beef and fried tofu.",
            price: 19250,
            tags: []
          },
          {
            id: "egg-drop-soup",
            name: "Egg Drop Soup",
            desc: "Silky egg ribbons in a light, savoury broth.",
            price: 19250,
            tags: []
          },
          {
            id: "mix-sashimi-salad",
            name: "Mix Sashimi Salad",
            desc: "Salmon, crab stick, wasabi sesame, spring onion, iceberg, tempura crunch, mayo and caviar.",
            price: 24200,
            tags: ["shellfish"]
          },
          {
            id: "octopus-salad",
            name: "Octopus Salad",
            desc: "Octopus, soy, wasabi sesame, spring onion, iceberg, tempura crunch, spicy mayo and caviar.",
            price: 19590,
            tags: ["shellfish", "spicy"]
          },
          {
            id: "japanese-cucumber-salad",
            name: "Japanese Cucumber Salad",
            desc: "Cucumber, sesame and soy dressing with a little crunch.",
            price: 15590,
            tags: ["veg"]
          }
        ]
      },
      {
        name: "Teriyaki mains",
        items: [
          {
            id: "chicken-teriyaki",
            name: "Chicken Teriyaki",
            desc: "Chicken in teriyaki sauce with garlic and vegetable rice.",
            price: 26800,
            tags: []
          },
          {
            id: "beef-teriyaki",
            name: "Beef Teriyaki",
            desc: "Beef in teriyaki sauce with garlic and vegetable rice.",
            price: 26800,
            tags: []
          },
          {
            id: "salmon-teriyaki",
            name: "Salmon Teriyaki",
            desc: "Salmon in teriyaki sauce with garlic and vegetable rice.",
            price: 42900,
            tags: []
          }
        ]
      }
    ]
  },
  {
    id: "thai",
    name: "Thai",
    kicker: "Lime · Chilli · Coconut",
    blurb:
      "Bright herbs, coconut milk, chilli and lime. Bangkok's balance of sweet, sour, salt and heat, cooked to order.",
    image: "thai",
    groups: [
      {
        name: "Small plates",
        items: [
          {
            id: "thai-chicken-satay",
            name: "Thai Chicken Satay",
            desc: "Marinated in Thai spices and coconut milk, served with peanut sauce.",
            price: 21500,
            tags: []
          },
          {
            id: "prawns-satay",
            name: "Prawns Satay",
            desc: "Marinated in Thai spices and coconut milk, served with peanut sauce.",
            price: 28600,
            tags: ["shellfish"]
          },
          {
            id: "batter-fried-cauliflowers",
            name: "Batter Fried Cauliflowers",
            desc: "Lightly battered cauliflower with Thai spices.",
            price: 20500,
            tags: ["veg"]
          },
          {
            id: "thai-fish-cakes",
            name: "Thai Fish Cakes",
            desc: "Served with namjim tod mun dipping sauce.",
            price: 19500,
            tags: []
          },
          {
            id: "honey-chili-potato-chips",
            name: "Honey Chili Potato Chips",
            desc: "Chips tossed with honey and chilli powder.",
            price: 17500,
            tags: ["veg", "spicy"]
          }
        ]
      },
      {
        name: "Soups",
        items: [
          {
            id: "tom-yum-chicken",
            name: "Tom Yum Chicken Soup",
            desc: "Chicken, lemongrass, lime leaf, galangal, mushroom and Thai paste with a drop of lime juice.",
            price: 20000,
            tags: ["spicy"]
          },
          {
            id: "tom-yum-seafood",
            name: "Tom Yum Seafood Soup",
            desc: "Mixed seafood, lemongrass, lime leaf, galangal, mushroom and Thai paste with a drop of lime juice.",
            price: 21500,
            tags: ["spicy", "shellfish"]
          },
          {
            id: "hot-and-sour-soup",
            name: "Hot and Sour Soup",
            desc: "Mushroom, sour sauce, vinegar and dark soy.",
            price: 19000,
            tags: ["veg"]
          }
        ]
      },
      {
        name: "Salads",
        items: [
          {
            id: "thai-beef-salad",
            name: "Thai Beef Salad",
            desc: "Spicy roasted beef, onions, coriander, leaf tomatoes, cucumber and spring onion with Thai sweet chilli and lime.",
            price: 19500,
            tags: ["spicy"]
          },
          {
            id: "thai-glass-noodle-salad",
            name: "Thai Spicy Glass Noodles Salad",
            desc: "Cooked onions, dried shrimps and chilli with glass noodles, lime juice, fish sauce and coriander leaf.",
            price: 26500,
            tags: ["spicy", "shellfish"]
          }
        ]
      },
      {
        name: "Noodles",
        items: [
          {
            id: "wok-fried-noodles-chicken-beef",
            name: "Wok Fried Noodles with Chicken or Beef",
            desc: "Rice noodles, marinated chicken or beef, carrot, cabbage, onion, scrambled egg and spring onion.",
            price: 24500,
            tags: []
          },
          {
            id: "pad-kee-mao",
            name: "Pad Kee Mao Noodles",
            desc: "Glass noodles, marinated beef, carrot, cabbage, onion, coriander and scrambled egg with spring onion.",
            price: 24100,
            tags: []
          },
          {
            id: "phad-thai-prawns",
            name: "Phad Thai Noodles with Prawns",
            desc: "Egg noodles, prawns, carrot, cabbage, onion, peanut and tamarind juice.",
            price: null,
            tags: ["shellfish"]
          },
          {
            id: "wok-fried-noodles-seafood",
            name: "Wok Fried Noodles with Seafood",
            desc: "Rice noodles, marinated seafood, carrot, cabbage, onion, scrambled egg and spring onion.",
            price: 28500,
            tags: ["shellfish"]
          }
        ]
      },
      {
        name: "Curries",
        items: [
          {
            id: "thai-curry-chicken",
            name: "Thai Curry Chicken",
            desc: "Curry paste, coconut milk, lemongrass and lime juice with a little sugar, served with egg fried rice.",
            price: 26000,
            tags: ["spicy"]
          },
          {
            id: "thai-prawn-curry",
            name: "Thai Prawn Curry",
            desc: "Curry paste, coconut milk, lemongrass and lime juice with a little sugar, served with egg fried rice.",
            price: 28500,
            tags: ["spicy", "shellfish"]
          },
          {
            id: "thai-beef-curry",
            name: "Thai Beef Curry",
            desc: "Curry paste, coconut milk, lemongrass and lime juice with a little sugar, served with pineapple rice.",
            price: 26000,
            tags: ["spicy"]
          },
          {
            id: "thai-fish-curry",
            name: "Thai Fish Curry",
            desc: "Curry paste, coconut milk, lemongrass and lime juice with a little sugar, served with steamed rice.",
            price: 28000,
            tags: ["spicy"]
          }
        ]
      }
    ]
  },
  {
    id: "italian",
    name: "Italian & Continental",
    kicker: "Pasta · Pizza · Grill",
    blurb:
      "Comfort classics done properly — pasta, pizza, burgers, seafood and a grill that runs all evening.",
    image: "pasta",
    groups: [
      {
        name: "Small plates",
        items: [
          {
            id: "chicken-spring-rolls",
            name: "Chicken Spring Rolls",
            desc: "Served with sweet chilli sauce.",
            price: 15500,
            tags: []
          },
          {
            id: "prawn-wrap",
            name: "Prawn Wrap",
            desc: "Served with sweet chilli sauce.",
            price: 20250,
            tags: ["shellfish"]
          },
          {
            id: "chicken-lollipop",
            name: "Chicken Lollipop",
            desc: "Served with barbecue sauce.",
            price: 20000,
            tags: []
          },
          {
            id: "chicken-wings",
            name: "Chicken Wings",
            desc: "Served in peppered sauce.",
            price: 15500,
            tags: ["spicy"]
          },
          {
            id: "batter-fried-fish",
            name: "Batter Fried Fish",
            desc: "Served with tartar sauce and French fries.",
            price: 20500,
            tags: []
          },
          {
            id: "fish-finger",
            name: "Fish Finger",
            desc: "Fish fillet in breadcrumbs, egg and flour marinade.",
            price: 22500,
            tags: []
          },
          {
            id: "chicken-finger",
            name: "Chicken Finger",
            desc: "Boneless chicken in breadcrumbs, egg and flour marinade.",
            price: 25200,
            tags: []
          },
          {
            id: "stir-fried-calamari",
            name: "Stir Fried Calamari",
            desc: "Oyster sauce, soy, shaoxing wine, vegetables and sesame oil.",
            price: 25200,
            tags: ["shellfish"]
          }
        ]
      },
      {
        name: "Salads",
        items: [
          {
            id: "caesar-salad",
            name: "Caesar Salad",
            desc: "Lettuce, croutons, parmesan, lemon, olive oil and black pepper with grilled marinated chicken.",
            price: 16900,
            tags: []
          },
          {
            id: "greek-salad",
            name: "Greek Salad",
            desc: "Red onion, cherry tomatoes, cucumber, green bell pepper, olives and feta.",
            price: 17000,
            tags: ["veg"]
          },
          {
            id: "tomatoes-cucumber-salad",
            name: "Tomatoes & Cucumber Salad",
            desc: "Classic tomatoes and cucumber with mayonnaise.",
            price: 15500,
            tags: ["veg"]
          }
        ]
      },
      {
        name: "Burgers & shawarma",
        items: [
          {
            id: "chicken-burger",
            name: "Chicken Burger",
            desc: "Ground chicken, breadcrumbs, seasoning, egg, cheese, tomato, onion and cucumber with chips and ketchup.",
            price: 19500,
            tags: []
          },
          {
            id: "beef-burger",
            name: "Beef Burger",
            desc: "Beef, breadcrumbs, seasoning, egg, cheese, tomato, onion and cucumber with chips and ketchup.",
            price: 19500,
            tags: []
          },
          {
            id: "chicken-shawarma",
            name: "Chicken Shawarma",
            desc: "Wrap bread, sauce and sausage, served with chips.",
            price: 15500,
            tags: []
          },
          {
            id: "beef-shawarma",
            name: "Beef Shawarma",
            desc: "Wrap bread, sauce and sausage, served with chips.",
            price: 15300,
            tags: []
          },
          {
            id: "vegetable-shawarma",
            name: "Vegetable Shawarma",
            desc: "Wrap bread, sauce and vegetables, served with chips.",
            price: 15000,
            tags: ["veg"]
          }
        ]
      },
      {
        name: "Pizza",
        items: [
          {
            id: "chicken-pizza",
            name: "Chicken Pizza",
            desc: "Red and green bell pepper with grilled marinated chicken, mozzarella and onion.",
            price: 20000,
            tags: []
          },
          {
            id: "beef-pizza",
            name: "Beef Pizza",
            desc: "Red and green bell pepper, marinated beef, onion and mozzarella.",
            price: 20000,
            tags: []
          },
          {
            id: "margherita-pizza",
            name: "Classic Margherita Pizza",
            desc: "Tomato concasse, mozzarella and basil.",
            price: 20000,
            tags: ["veg"]
          },
          {
            id: "seafood-pizza",
            name: "Seafood Pizza",
            desc: "Red and green bell pepper, onion and mixed marinated seafood with mozzarella.",
            price: 22500,
            tags: ["shellfish"]
          }
        ]
      },
      {
        name: "Pasta",
        items: [
          {
            id: "seafood-penne-pasta",
            name: "Seafood Penne Pasta",
            desc: "White sauce with prawns, fish fillet, calamari and octopus in a cream sauce.",
            price: 26100,
            tags: ["shellfish"]
          },
          {
            id: "chicken-alfredo",
            name: "Chicken Alfredo Pasta",
            desc: "White or tomato sauce with diced chicken in a cream sauce.",
            price: 22500,
            tags: []
          },
          {
            id: "arrabbiata-chicken",
            name: "Arrabbiata Chicken",
            desc: "With tomato sauce.",
            price: 22500,
            tags: ["spicy"]
          },
          {
            id: "arrabbiata-seafood",
            name: "Arrabbiata Seafood",
            desc: "With tomato sauce.",
            price: 26100,
            tags: ["spicy", "shellfish"]
          },
          {
            id: "spaghetti-bolognese",
            name: "Spaghetti Bolognese",
            desc: "Ground beef, onion, carrot, celery, tomato paste and red wine with spaghetti.",
            price: 22500,
            tags: []
          }
        ]
      },
      {
        name: "Mains",
        items: [
          {
            id: "roasted-chicken-breast",
            name: "Roasted Chicken Breast",
            desc: "Grilled chicken breast with mashed potato and stir-fried vegetables.",
            price: 22500,
            tags: []
          },
          {
            id: "chicken-basket",
            name: "Chicken Basket",
            desc: "Crumb-fried chicken with potato chips, coleslaw and tartar sauce.",
            price: 22500,
            tags: []
          },
          {
            id: "chinese-chicken-fried-rice",
            name: "Chinese Chicken Fried Rice",
            desc: "Marinated chicken, basmati rice, onion, garlic, ginger, white pepper, oyster sauce, sesame oil, egg and spring onion.",
            price: 18500,
            tags: []
          },
          {
            id: "mix-meat-fried-rice",
            name: "Mix Meat Fried Rice",
            desc: "Marinated mixed meat, chicken, beef and prawns with basmati rice, ginger, garlic, oyster sauce, sesame oil and spring onion.",
            price: 35000,
            tags: ["shellfish"]
          }
        ]
      }
    ]
  },
  {
    id: "grill",
    name: "Grill & Suya",
    kicker: "Charcoal · Yaji · Smoke",
    blurb:
      "Charcoal, smoke and yaji spice. Our grill runs from suya skewers to whole fish, T-bone and a seafood mixed grill.",
    image: "grill",
    groups: [
      {
        name: "Suya",
        items: [
          {
            id: "full-chicken-suya",
            name: "Full Local Chicken Suya",
            desc: "Charcoal-grilled local chicken with yaji spice.",
            price: 30000,
            tags: ["spicy"]
          },
          {
            id: "beef-suya",
            name: "Beef Suya",
            desc: "Six sticks, charcoal-grilled with yaji spice.",
            price: 20000,
            tags: ["spicy"]
          },
          {
            id: "bbq-fish",
            name: "BBQ Cat or Crocker Fish",
            desc: "Whole fish grilled over charcoal.",
            price: 30000,
            tags: ["spicy"]
          },
          {
            id: "bbq-half-chicken",
            name: "BBQ Half Chicken",
            desc: "Half chicken, grilled over charcoal.",
            price: 15000,
            tags: ["spicy"]
          }
        ]
      },
      {
        name: "From the grill",
        items: [
          {
            id: "mixed-meat-grilled",
            name: "Mixed Meat Grilled",
            desc: "Lamb chop, chicken, beef and sausage with fried eggs, French fries and garlic sauce.",
            price: 40500,
            tags: []
          },
          {
            id: "t-bone-steak",
            name: "T-Bone Steak",
            desc: "Grilled and marinated T-bone with mashed potato and buttered vegetables.",
            price: 28500,
            tags: []
          },
          {
            id: "seafood-mix-grilled",
            name: "Seafood Mix Grilled",
            desc: "Fish fillet, calamari, prawns, jumbo prawns and octopus with French fries and lemon butter sauce.",
            price: 50000,
            tags: ["shellfish"]
          },
          {
            id: "salmon-steak",
            name: "Salmon Steak",
            desc: "Grilled and marinated salmon with mashed potato and buttered vegetables.",
            price: 40000,
            tags: []
          }
        ]
      },
      {
        name: "Tacos",
        items: [
          {
            id: "chicken-tacos",
            name: "Chicken Tacos",
            desc: "Hard shell, cheddar, lettuce, tomato, onion, salsa and sour cream.",
            price: 20500,
            tags: []
          },
          {
            id: "prawns-tacos",
            name: "Prawns Tacos",
            desc: "Hard shell, cheddar, lettuce, tomato, onion, salsa and sour cream.",
            price: 26000,
            tags: ["shellfish"]
          },
          {
            id: "beef-tacos",
            name: "Beef Tacos",
            desc: "Hard shell, cheddar, lettuce, tomato, onion, salsa and sour cream.",
            price: 20000,
            tags: []
          },
          {
            id: "vegetable-tacos",
            name: "Vegetable Tacos",
            desc: "Hard shell, cheddar, lettuce, tomato, onion, salsa and sour cream.",
            price: 19500,
            tags: ["veg"]
          }
        ]
      },
      {
        name: "Nigerian rice & plantain",
        items: [
          {
            id: "jollof-chicken",
            name: "Jollof or Fried Rice with Chicken",
            desc: "Served with a choice of jollof or fried rice.",
            price: 15500,
            tags: []
          },
          {
            id: "jollof-beef-goat",
            name: "Jollof or Fried Rice with Beef or Goat",
            desc: "Served with a choice of jollof or fried rice.",
            price: 15000,
            tags: []
          },
          {
            id: "jollof-fish",
            name: "Jollof or Fried Rice with Crocker or Cat Fish",
            desc: "Served with a choice of jollof or fried rice.",
            price: 16000,
            tags: []
          },
          {
            id: "steam-rice-chicken",
            name: "Steam Rice with Chicken",
            desc: "Served with tomato sauce.",
            price: 19500,
            tags: []
          },
          {
            id: "steam-rice-beef-goat",
            name: "Steam Rice with Goat Meat or Beef",
            desc: "Served with tomato sauce.",
            price: 18500,
            tags: []
          },
          {
            id: "steam-rice-fish",
            name: "Steam Rice with Cat or Crocker Fish",
            desc: "Served with tomato sauce.",
            price: 19500,
            tags: []
          },
          {
            id: "plantain-meat",
            name: "Fried or Boiled Plantain with Meat",
            desc: "Choice of goat meat, beef or chicken sauce.",
            price: 20000,
            tags: []
          },
          {
            id: "plantain-fish",
            name: "Fried or Boiled Plantain with Fish",
            desc: "Choice of cat or crocker fish sauce.",
            price: 20000,
            tags: []
          }
        ]
      }
    ]
  },
  {
    id: "indian",
    name: "Indian & African",
    kicker: "Biryani · Pepper soup · Spice",
    blurb:
      "Warm spice from both kitchens — biryani and butter chicken beside pepper soup, gizzard and Nigerian noodles.",
    image: "indian",
    groups: [
      {
        name: "Indian starters",
        items: [
          {
            id: "tandoori-chicken",
            name: "Tandoori Chicken",
            desc: "Clay-oven chicken with yoghurt and Indian spices.",
            price: 20000,
            tags: ["spicy"]
          },
          {
            id: "tandoor-broccoli",
            name: "Tandoor Broccoli",
            desc: "Charred broccoli with tandoori spice.",
            price: 19000,
            tags: ["veg"]
          },
          {
            id: "tandoori-cauliflower",
            name: "Tandoori Cauliflower",
            desc: "Charred cauliflower with tandoori spice.",
            price: 19000,
            tags: ["veg"]
          }
        ]
      },
      {
        name: "Indian mains",
        items: [
          {
            id: "chicken-beef-biryani",
            name: "Chicken or Beef Biryani",
            desc: "Skinless chicken or beef, plain yoghurt, ginger, garlic, cloves, turmeric and biryani masala with mint.",
            price: 20000,
            tags: []
          },
          {
            id: "seafood-biryani",
            name: "Seafood Biryani",
            desc: "Mixed seafood, plain yoghurt, ginger, garlic, cloves, turmeric and biryani masala with mint.",
            price: 26000,
            tags: ["shellfish"]
          },
          {
            id: "vegetable-biryani",
            name: "Vegetable Biryani",
            desc: "Mixed vegetables, plain yoghurt, ginger, garlic, cloves, turmeric and biryani masala with mint.",
            price: 19000,
            tags: ["veg"]
          },
          {
            id: "butter-chicken-masala",
            name: "Butter Chicken Masala",
            desc: "Marinated chicken, yoghurt, ginger, garlic, garam masala, turmeric, lemon, butter and coriander with rice or naan.",
            price: 26500,
            tags: []
          },
          {
            id: "chicken-curry",
            name: "Chicken Curry",
            desc: "Boneless chicken, cloves, ginger, garlic and curry powder with steamed rice or naan.",
            price: 26500,
            tags: ["spicy"]
          }
        ]
      },
      {
        name: "Pepper & African",
        items: [
          {
            id: "pepper-chicken",
            name: "Pepper Chicken",
            desc: "Choice of protein prepared in African style, served with chips.",
            price: 20000,
            tags: ["spicy"]
          },
          {
            id: "pepper-beef",
            name: "Pepper Beef",
            desc: "Choice of protein prepared in African style, served with chips.",
            price: 20000,
            tags: ["spicy"]
          },
          {
            id: "pepper-goat",
            name: "Pepper Goat Meat",
            desc: "Choice of protein prepared in African style, served with chips.",
            price: 20000,
            tags: ["spicy"]
          },
          {
            id: "pepper-fish",
            name: "Pepper Crocker or Cat Fish",
            desc: "Choice of protein prepared in African style, served with chips.",
            price: 20000,
            tags: ["spicy"]
          },
          {
            id: "pepper-gizzard",
            name: "Pepper Gizzard",
            desc: "Choice of protein prepared in African style, served with chips.",
            price: 20000,
            tags: ["spicy"]
          }
        ]
      },
      {
        name: "Pepper soups",
        items: [
          {
            id: "chicken-pepper-soup",
            name: "Chicken Pepper Soup",
            desc: "African-style pepper broth, served with bread roll.",
            price: 17000,
            tags: ["spicy"]
          },
          {
            id: "goat-pepper-soup",
            name: "Goat Meat Pepper Soup",
            desc: "African-style pepper broth, served with bread roll.",
            price: 17000,
            tags: ["spicy"]
          },
          {
            id: "fish-pepper-soup",
            name: "Cat or Crocker Fish Pepper Soup",
            desc: "African-style pepper broth, served with bread roll.",
            price: 17000,
            tags: ["spicy"]
          }
        ]
      },
      {
        name: "Nigerian noodles",
        items: [
          {
            id: "egg-noodles",
            name: "Egg Noodles",
            desc: "Wok-tossed noodles with egg.",
            price: 13000,
            tags: []
          },
          {
            id: "vegetable-noodles",
            name: "Vegetable Noodles",
            desc: "Wok-tossed noodles with vegetables.",
            price: 12500,
            tags: ["veg"]
          },
          {
            id: "chicken-beef-noodles",
            name: "Chicken or Beef Noodles",
            desc: "Wok-tossed noodles with chicken or beef.",
            price: 14000,
            tags: []
          },
          {
            id: "fish-noodles",
            name: "Cat or Crocker Fish Noodles",
            desc: "Wok-tossed noodles with cat or crocker fish.",
            price: 14000,
            tags: []
          }
        ]
      }
    ]
  },
  {
    id: "sides",
    name: "Sides",
    kicker: "Rice · Naan · Plantain",
    blurb: "The supporting cast — naan, plantain, rice and fries, all made to order.",
    image: null,
    groups: [
      {
        name: "Sides",
        items: [
          {
            id: "mash-potato",
            name: "Mash Potato",
            desc: "Buttery mashed potato.",
            price: 12500,
            tags: ["veg"]
          },
          {
            id: "french-fries",
            name: "French Fries",
            desc: "Golden fries.",
            price: 12500,
            tags: ["veg"]
          },
          {
            id: "stir-fried-vegetable",
            name: "Stir Fried Vegetable",
            desc: "Seasonal vegetables, wok-tossed.",
            price: 12500,
            tags: ["veg"]
          },
          {
            id: "egg-fried-rice",
            name: "Egg Fried Rice",
            desc: "Wok-tossed rice with egg.",
            price: 12500,
            tags: []
          },
          {
            id: "vegetable-fried-rice",
            name: "Vegetable Fried Rice",
            desc: "Wok-tossed rice with vegetables.",
            price: 12500,
            tags: ["veg"]
          },
          {
            id: "garlic-butter-naan",
            name: "Garlic or Butter Naan",
            desc: "Tandoor-baked naan.",
            price: 12500,
            tags: ["veg"]
          },
          {
            id: "garlic-rice",
            name: "Garlic Rice",
            desc: "Fragrant rice with garlic.",
            price: 12500,
            tags: ["veg"]
          },
          {
            id: "fried-plantain",
            name: "Fried Plantain",
            desc: "Sweet, golden plantain.",
            price: 12500,
            tags: ["veg"]
          }
        ]
      }
    ]
  }
];

window.MISO_SIGNATURES = [
  {
    itemId: "volcano-roll",
    image: "sushi",
    label: "From the sushi counter",
    note: "Tempura prawn, cucumber and a slow burn of spicy mayo."
  },
  {
    itemId: "tom-yum-seafood",
    image: "thai",
    label: "From the Thai kitchen",
    note: "Lemongrass, lime and chilli, with a bowl full of seafood."
  },
  {
    itemId: "seafood-mix-grilled",
    image: "grill",
    label: "From the charcoal grill",
    note: "Prawns, calamari, octopus and fish with lemon butter."
  },
  {
    itemId: "seafood-penne-pasta",
    image: "pasta",
    label: "From the pasta pot",
    note: "Prawns, fish, calamari and octopus in a white cream sauce."
  }
];
