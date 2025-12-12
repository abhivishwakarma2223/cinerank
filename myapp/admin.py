

# Register your models here.
# myapp/admin.py

from django.contrib import admin
from .models import WatchlistItem, profile_pic # Import your model

@admin.register(WatchlistItem)
class WatchlistItemAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'tmdb_id', 'watched', 'user_rating')
    search_fields = ('title', 'user__username')

@admin.register(profile_pic)
class profile_picAdmin(admin.ModelAdmin):
    list_display = ('user', 'image')
    search_fields = ('user__username',)