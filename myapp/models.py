# myapp/models.py

from django.db import models
from django.contrib.auth.models import User 
from PIL import Image
from django.conf import settings

class WatchlistItem(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE) 
    tmdb_id = models.IntegerField()
    title = models.CharField(max_length=255)
    poster_path = models.CharField(max_length=255, null=True, blank=True)
    release_date = models.DateField(null=True, blank=True)
    overview = models.TextField(null=True, blank=True)
    
    # TMDB rating (for display)
    vote_average = models.FloatField(null=True, blank=True) 
    
    # User-driven fields (for recommendation logic)
    watched = models.BooleanField(default=False) 
    user_rating = models.IntegerField(null=True, blank=True) # 1 to 5 stars

    def __str__(self):
        return f'{self.user.username}: {self.title} (Rated: {self.user_rating})'

    class Meta:
        # Ensures a user can only add the same movie once
        unique_together = ('user', 'tmdb_id')


class profile_pic(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile')
    image = models.ImageField(upload_to='profile_pics/', default='profile_pics/default.png')

    def __str__(self):
        # Good practice: Returns a human-readable name in the Django Admin
        return f'{self.user.username} Profile Picture'
    
    # class Meta:
    #     db_table = 'profile_pic' # Optional: Defines the database table name
        
    # # OPTIONAL: Override the save method to automatically resize the image
    # This prevents users from uploading massive files that slow down the page load.
    # def save(self, *args, **kwargs):
    #     super().save(*args, **kwargs)

    #     # Skip resizing if the image is still the default one or if file is missing
    #     if self.image.name == 'default_profile.png':
    #         return
            
    #     try:
    #         img = Image.open(self.image.path)

    #         if img.height > 300 or img.width > 300:
    #             output_size = (300, 300)
    #             img.thumbnail(output_size)
    #             # Overwrite the original file with the resized version
    #             img.save(self.image.path)
    #     except FileNotFoundError:
    #         # Handle the case where the file might not be found immediately after save
    #         pass

    