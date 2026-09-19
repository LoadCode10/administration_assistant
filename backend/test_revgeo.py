import requests

def reverse_geocode(lat: float, lon: float) -> str | None:
  resp = requests.get(
    "https://nominatim.openstreetmap.org/reverse",
    params={"lat": lat, "lon": lon, "format": "json", "zoom": 10},
    headers={"User-Agent": "Ijraia/1.0 (contact@exemple.ma)"},
    timeout=10,
  )
  if resp.status_code != 200:
    return None
  addr = resp.json().get("address", {})
  return addr.get("city") or addr.get("town") or addr.get("state")

if __name__ == "__main__":
  villes = {
    "Rabat":       (34.0209, -6.8416),
    "Casablanca":  (33.5731, -7.5898),
    "Meknès":      (33.8935, -5.5473),
    "Fès":         (34.0181, -5.0078),
    "Marrakech":   (31.6295, -7.9811),
    "Tanger":      (35.7595, -5.8340),
    "Agadir":      (30.4278, -9.5981),
    "Oujda":       (34.6867, -1.9114),
  }

  ville = reverse_geocode(34.00014335021459 , -6.86615191888412)
  print(ville)