import getpass
from database import SessionLocal
import models
from security import hash_password


def create_admin():
  session = SessionLocal()
  try:
    existing_admin = session.query(models.User).filter_by(role=models.UserRole.admin).first()
    if existing_admin is not None:
      print(f"An admin already exists ({existing_admin.email_user}), skipping creation.")
      return

    nom = input("Nom: ").strip()
    prenom = input("Prenom: ").strip()
    email = input("Email: ").strip()
    phone = input("Phone (optional): ").strip() or None
    password = getpass.getpass("Password: ")

    if session.query(models.User).filter_by(email_user=email).first() is not None:
      print(f"A user with email {email} already exists.")
      return

    admin = models.User(
      nom_user=nom,
      prenom_user=prenom,
      email_user=email,
      phone_user=phone,
      hashed_password=hash_password(password),
      role=models.UserRole.admin,
    )
    session.add(admin)
    session.commit()
    print(f"Admin created with id: {admin.id_user}")
  finally:
    session.close()


if __name__ == "__main__":
  create_admin()
