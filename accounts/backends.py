from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend

UserModel = get_user_model()


class EmailOrUsernameModelBackend(ModelBackend):
    """
    Authentication backend that accepts either the username or the email
    address as the login identifier.

    Notes
    -----
    * Both lookups are case-insensitive.
    * Username is tried first, so a real username can never be shadowed by
      somebody else's email address.
    * The email branch only runs when the identifier contains "@", which
      saves a query on ordinary username logins.
    * When no user matches we still run the password hasher once, so login
      timing does not leak whether an account exists.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        # LoginView passes the identifier as `username`; other callers
        # (e.g. API code) may pass `email` instead.
        if username is None:
            username = kwargs.get(UserModel.USERNAME_FIELD) or kwargs.get("email")

        if not username or password is None:
            return None

        identifier = username.strip()

        user = UserModel.objects.filter(username__iexact=identifier).first()

        if user is None and "@" in identifier:
            user = (
                UserModel.objects.filter(email__iexact=identifier)
                .exclude(email="")
                .order_by("pk")
                .first()
            )

        if user is None:
            # Mitigate timing attacks that would reveal account existence.
            UserModel().set_password(password)
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
