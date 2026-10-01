"""Donne le rôle administrateur à un compte existant.

Il n'y a volontairement pas de bouton « devenir admin » dans l'interface :
un compte ne doit pas pouvoir s'auto-promouvoir.

    python3 promouvoir_admin.py vous@exemple.com
"""
import sys

from db import get_connection


def main():
    if len(sys.argv) != 2:
        print("Usage : python3 promouvoir_admin.py courriel@exemple.com")
        raise SystemExit(1)

    courriel = sys.argv[1].strip().lower()
    connexion_bd = get_connection()
    curseur = connexion_bd.execute(
        "UPDATE utilisateurs SET role = 'admin' WHERE courriel = ?", (courriel,)
    )
    connexion_bd.commit()
    connexion_bd.close()

    if curseur.rowcount == 0:
        print(f"Aucun compte trouvé avec le courriel {courriel}.")
    else:
        print(f"{courriel} est maintenant administrateur.")


if __name__ == "__main__":
    main()
