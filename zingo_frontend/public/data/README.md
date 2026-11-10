# Data files

## pk-places.json

Pakistan provinces and cities, used for the city and territory dropdowns.

- **Source:** [GeoNames](https://www.geonames.org) data dump for Pakistan (`PK.zip` and `admin1CodesASCII.txt`), <https://download.geonames.org/export/dump/>
- **Licence:** Creative Commons Attribution 4.0. Keep this attribution when you reuse the file: "Place names from GeoNames, https://www.geonames.org, licensed under Creative Commons Attribution 4.0."
- **What is in it:** every populated place with 5,000 or more people, plus every district and provincial seat, sorted by population (517 cities). Sections of cities, abandoned or destroyed places and farm villages are left out.
- **Fields:** `provinces[]` (`name`, `cities` count) and `cities[]` (`name`, `province`, `population`, `lat`, `lon`, `seat`).
- **Refresh:** download a newer dump from the URL above and rebuild the file with `npm run data:places` in `zingo_frontend`.
