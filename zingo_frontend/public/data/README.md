# Data files

## pk-places.json

Pakistan provinces, districts and cities, used for the territory dropdowns (province -> district -> city).

- **Source:** [GeoNames](https://www.geonames.org) data dump for Pakistan (`PK.zip`, `admin1CodesASCII.txt` and `admin2Codes.txt`), <https://download.geonames.org/export/dump/>
- **Licence:** Creative Commons Attribution 4.0. Keep this attribution when you reuse the file: "Place names from GeoNames, https://www.geonames.org, licensed under Creative Commons Attribution 4.0."
- **What is in it:** every populated place with 5,000 or more people, plus every district and provincial seat, sorted by population (517 cities). Sections of cities, abandoned or destroyed places and farm villages are left out.
- **Fields:** `provinces[]` (`name`, `cities` count), `districts[]` (`name`, `province`) and `cities[]` (`name`, `province`, `district`, `population`, `lat`, `lon`, `seat`). Karachi and Islamabad have no district in GeoNames and count as their own district.
- **Refresh:** download a newer dump from the URL above and rebuild the file with `npm run data:places` in `zingo_frontend`.
