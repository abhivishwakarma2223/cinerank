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
 
   

    # keep profile_update as a separate route until we confirm everything
    path('api/profile/update/', views.profile_update, name='profile_update'),
    path('api/search-suggest/', views.search_suggest, name='search_suggest'),
    path('api/search/', views.api_search, name='api_search'),
    path('api/toggle_watchlist/', views.toggle_watchlist, name='toggle_watchlist'),
    path('api/rating/submit/', views.submit_rating, name='submit_rating'),
    path('movie/<int:tmdb_id>/', views.movie_detail, name='movie_detail'),


]
