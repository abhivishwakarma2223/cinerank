# myapp/urls.py
from django.urls import path
from . import views
from django.contrib.auth import views as auth_views

urlpatterns = [
    path('', views.index, name='index'),
    # serve profile page with the view that was working before
    path('profile/', views.profile, name='profile'),

    # other routes...
    path('watchlist/', views.watchlist, name='watchlist'),
    path('login/', views.login, name='login'),
    path('signup/', views.signup, name='signup'),
    path('logout/', views.logout, name='logout'),
    path('profile/edit/', views.edit_profile, name='edit_profile'),
   

    # keep profile_update as a separate route until we confirm everything
    path('api/profile/update/', views.profile_update, name='profile_update'),
    path('api/search-suggest/', views.search_suggest, name='search_suggest'),
    path('api/search/', views.api_search, name='api_search'),
    path('api/toggle_watchlist/', views.toggle_watchlist, name='toggle_watchlist'),
    path('api/rating/submit/', views.submit_rating, name='submit_rating'),
    path('movie/<int:tmdb_id>/', views.movie_detail, name='movie_detail'),

    path('password-reset/', auth_views.PasswordResetView.as_view(
            template_name='registration/password_reset.html',
            email_template_name='registration/password_reset_email.txt',
            subject_template_name='registration/password_reset_subject.txt',
            success_url='done/'
        ), name='password_reset'),

    # Email sent page
    path('password-reset/done/', auth_views.PasswordResetDoneView.as_view(
            template_name='registration/password_reset_done.html'
        ), name='password_reset_done'),

    # Link in email → set new password (uidb64 and token in URL)
    path('reset/<uidb64>/<token>/', auth_views.PasswordResetConfirmView.as_view(
            template_name='registration/password_reset_confirm.html',
            success_url='/password-reset/complete/'
        ), name='password_reset_confirm'),

    # Password reset complete
    path('password-reset/complete/', auth_views.PasswordResetCompleteView.as_view(
            template_name='registration/password_reset_complete.html'
        ), name='password_reset_complete'),

]
