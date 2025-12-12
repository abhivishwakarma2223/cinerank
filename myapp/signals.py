# myapp/signals.py
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.apps import AppConfig

from .models import profile_pic

User = get_user_model()

class MyappConfig(AppConfig):
    name = 'myapp'

    def ready(self):
        import myapp.signals  # noqa: F401



@receiver(post_save, sender=User)
def create_profile_for_new_user(sender, instance, created, **kwargs):
    """
    Ensure that a profile_pic row exists for every newly created User.
    Uses get_or_create so it is safe whether or not a reverse attribute exists.
    """
    if created:
        profile_pic.objects.get_or_create(user=instance)


@receiver(post_save, sender=User)
def ensure_profile_exists_on_user_save(sender, instance, **kwargs):
    """
    Defensive guard: if other code assumes a profile exists when a user is saved,
    ensure it exists. This prevents AttributeError on access like user.profile_pic.
    It's safe because get_or_create will not duplicate rows.
    """
    profile_pic.objects.get_or_create(user=instance)


@receiver(post_save, sender=profile_pic)
def on_profile_pic_saved(sender, instance, **kwargs):
    """
    Optional: place to add side-effects when a profile is created/updated.
    Keep this minimal: do NOT assume instance.user has a reverse attribute like
    instance.user.profile_pic (use instance directly).
    """
    # If you need to perform some action when a profile_pic is saved, do it here.
    # Example (no-op): ensure image path stored correctly.
    if not instance.user:
        return
    # Example: you could log or recalculate a cached thumbnail, but keep it safe.
    return
