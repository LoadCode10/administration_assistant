from database import SessionLocal
import models

session = SessionLocal()

try:

  administration_1 = models.Administration(
    nom_administration = "CNOPS",
    addr_administration = "RUE AL KHALIL RABAT",
    url_administration = "https://www.cnops.org.ma"
  )

  session.add(administration_1)
  session.commit()
  print(f"Inserted administration with id: {administration_1.id_administration}")
finally:
  session.close()