from django.urls import path
from django.contrib.auth import views as auth_views

from . import views
from .forms import EmailOrUsernameAuthenticationForm

app_name = "accounts"

urlpatterns = [
    # Legacy
    path("signup/", views.signup, name="signup"),

    # Tier-aware signups
    path("signup/individual/", views.signup_individual, name="signup_individual"),
    path("signup/team/", views.signup_team, name="signup_team"),
    path("signup/corporate/", views.signup_corporate, name="signup_corporate"),

    # Invite-triggered signups
    path("signup/invite/<str:token>/", views.signup_with_invite, name="signup_with_invite"),
    path("signup/join-org/<int:membership_id>/", views.signup_to_org, name="signup_to_org"),

    # Auth
    path(
        "login/",
        auth_views.LoginView.as_view(
            template_name="accounts/login.html",
            authentication_form=EmailOrUsernameAuthenticationForm,
        ),
        name="login",
    ),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),

    # Profile + signed-in devices
    path("profile/", views.profile_view, name="profile"),
    path("profile/sessions/end/", views.session_end, name="session_end"),
    path("profile/sessions/end-others/", views.session_end_others, name="session_end_others"),
]
