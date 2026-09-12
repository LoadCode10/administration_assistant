import getpass
from database import SessionLocal
from security import hash_password
import models

def main():
  db = SessionLocal()
  try:
    existing_admin = db.query(models.User).filter_by(role=models.UserRole.admin.value).first()
    if existing_admin is not None:
      print(f"Un administrateur existe déjà : {existing_admin.email_user}")
      return

    print("Création du compte administrateur")
    nom = input("Nom : ").strip()
    prenom = input("Prénom : ").strip()
    email = input("Email : ").strip()
    password = getpass.getpass("Mot de passe : ")
    confirm = getpass.getpass("Confirmer le mot de passe : ")

    if password != confirm:
      print("Les mots de passe ne correspondent pas.")
      return
    if len(password) < 8:
      print("Le mot de passe doit contenir au moins 8 caractères.")
      return

    existing_email = db.query(models.User).filter_by(email_user=email).first()
    if existing_email is not None:
      print("Un utilisateur avec cet email existe déjà.")
      return

    admin = models.User(
      nom_user=nom,
      prenom_user=prenom,
      email_user=email,
      password_hash=hash_password(password),
      role=models.UserRole.admin.value,
    )
    db.add(admin)
    db.commit()
    print(f"Administrateur créé : {email}")
  finally:
    db.close()

if __name__ == "__main__":
  main()
