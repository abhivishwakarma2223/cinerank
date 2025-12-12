# myapp/views.py
from datetime import date
import json
import random
import operator
import requests
from django import forms
from django.conf import settings
from django.contrib import auth, messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
import logging
from django.http import JsonResponse
from .models import WatchlistItem, profile_pic
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from django.views.decorators.http import require_GET, require_POST
from django.core.cache import cache



SESSION = requests.Session()

logger = logging.getLogger(__name__)

# Keep a single requests session for API calls

User = get_user_model()

BOLLYWOOD_LANGUAGE_CODE = 'hi'
BOLLYWOOD_REGION_CODE = 'IN'

TMDB_SESSION = globals().get('TMDB_SESSION', None)
TMDB_TIMEOUT = globals().get('TMDB_TIMEOUT', (3, 8))
TMDB_BASE = getattr(settings, 'TMDB_BASE_URL', 'https://api.themoviedb.org/3')
TMDB_API_KEY = getattr(settings, 'TMDB_API_KEY', None)


# -------------------------
# Recommendation engine (kept mostly as you had it)
# -------------------------
GENRE_ID_MAP = {
    'Action': 28, 'Adventure': 12, 'Animation': 16, 'Comedy': 35,
    'Crime': 80, 'Documentary': 99, 'Drama': 18, 'Family': 10751,
    'Fantasy': 14, 'History': 36, 'Horror': 27, 'Music': 10402,
    'Mystery': 9648, 'Romance': 10749, 'Science Fiction': 878,
    'TV Movie': 10770, 'Thriller': 53, 'War': 10752, 'Western': 37
}




# configure a session with retries/backoff for TMDB requests
TMDB_SESSION = requests.Session()
retries = Retry(
    total=3,                     # total attempts = 1 original + 3 retries
    backoff_factor=0.7,          # exponential backoff: 0.7s, 1.4s, 2.8s
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset(['GET', 'POST'])
)
adapter = HTTPAdapter(max_retries=retries)
TMDB_SESSION.mount('https://', adapter)
TMDB_SESSION.mount('http://', adapter)

# sensible default timeout (connect, read) tuple (seconds)
# connect timeout short, read timeout a bit longer
TMDB_TIMEOUT = (3, 8)   # connect timeout 3s, read timeout 8s (tweakable)
TMDB_BASE = getattr(settings, 'TMDB_BASE_URL', 'https://api.themoviedb.org/3')
TMDB_API_KEY = getattr(settings, 'TMDB_API_KEY', None)



def fetch_recommendations(user):
    TMDB_BASE_URL = settings.TMDB_BASE_URL
    TMDB_API_KEY = settings.TMDB_API_KEY
    TIMEOUT_DURATION = 15

    current_year = date.today().year
    release_year_filter = current_year - random.randint(0, 3)
    random_page = random.randint(1, 5)

    top_rated_items = WatchlistItem.objects.filter(
        user=user,
        user_rating__in=[4, 5]
    ).values('tmdb_id')

    if not top_rated_items:
        return []

    # Compute genre affinity using unique movie IDs
    genre_contribution = {}
    for item in top_rated_items:
        tmdb_id = item['tmdb_id']
        detail_url = f"{TMDB_BASE_URL}/movie/{tmdb_id}?api_key={TMDB_API_KEY}"
        try:
            response = SESSION.get(detail_url, timeout=5)
            if response.status_code == 200:
                movie_data = response.json()
                for genre in movie_data.get('genres', []):
                    name = genre.get('name')
                    if not name:
                        continue
                    genre_contribution.setdefault(name, set()).add(tmdb_id)
        except requests.exceptions.RequestException:
            continue

    if not genre_contribution:
        return []

    final_genre_scores = {name: len(s) for name, s in genre_contribution.items()}
    sorted_genres = sorted(final_genre_scores.items(), key=operator.itemgetter(1), reverse=True)
    top_genre_names = [name for name, _ in sorted_genres[:5]]

    combined_genre_ids = ','.join(
        map(str, [GENRE_ID_MAP[name] for name in top_genre_names if name in GENRE_ID_MAP])
    )

    if not combined_genre_ids:
        return []

    discover_url = (
        f"{TMDB_BASE_URL}/discover/movie?"
        f"api_key={TMDB_API_KEY}&"
        f"sort_by=vote_average.desc&"
        f"vote_count.gte=100&"
        f"page={random_page}&"
        f"primary_release_year={release_year_filter}&"
        f"with_genres={combined_genre_ids}&"
        f"with_origin_country={BOLLYWOOD_REGION_CODE}"
    )

    try:
        reco_response = SESSION.get(discover_url, timeout=TIMEOUT_DURATION)
        if reco_response.status_code == 200:
            recommendations = reco_response.json().get('results', [])
            if not recommendations:
                # broaden if no results for region filter
                broad_url = (
                    f"{TMDB_BASE_URL}/discover/movie?"
                    f"api_key={TMDB_API_KEY}&"
                    f"sort_by=vote_average.desc&"
                    f"vote_count.gte=100&"
                    f"with_genres={combined_genre_ids}"
                )
                broad_response = SESSION.get(broad_url, timeout=TIMEOUT_DURATION)
                if broad_response.status_code == 200:
                    recommendations = broad_response.json().get('results', [])
            return recommendations
        return []
    except requests.exceptions.RequestException:
        return []




class ProfileUpdateForm(forms.ModelForm):
    class Meta:
        model = profile_pic
        fields = ['image']  # <-- make sure this matches your model field name
        widgets = {
            'image': forms.ClearableFileInput(attrs={'id': 'profile-image-input'})
        }

    # Example of server-side validation
    def clean_image(self):
        image = self.cleaned_data.get('image')
        if image:
            # Optional: check content type
            if not image.content_type.startswith('image/'):
                raise forms.ValidationError('File type is not image.')
            # Optional: size check (5MB)
            if image.size > 5 * 1024 * 1024:
                raise forms.ValidationError('Please use an image smaller than 5MB.')
        return image

    def clean_image(self):
        image = self.cleaned_data.get('image')
        if image:
            # Basic type check
            content_type = getattr(image, 'content_type', '')
            if content_type and not content_type.startswith('image/'):
                raise forms.ValidationError('Uploaded file is not an image.')
            # Basic size limit (5MB) - change as needed
            max_size_mb = 5
            if image.size > max_size_mb * 1024 * 1024:
                raise forms.ValidationError(f'Image file too large (max {max_size_mb} MB).')
        return image


# -------------------------
# Views: auth + index
# -------------------------
def index(request):
    recommendations = []
    if request.user.is_authenticated:
        recommendations = fetch_recommendations(request.user)
    return render(request, 'index.html', {'recommendations': recommendations})


def login(request):
    if request.method == 'POST':
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            auth.login(request, user)
            messages.success(request, f"Welcome back, {user.username}! Login successful.")
            return redirect('index')
        else:
            messages.error(request, "Invalid Username or Password. Please try again.")
            return render(request, 'login.html', {'form': form})
    return render(request, 'login.html', {'form': AuthenticationForm()})


def signup(request):
    if request.method == 'POST':
        fn = request.POST.get('fname')
        ln = request.POST.get('lname')
        un = request.POST.get('un')
        em = request.POST.get('email')
        p1 = request.POST.get('pass1')
        p2 = request.POST.get('pass2')

        if p1 != p2:
            messages.error(request, "Password Doesn't Match!")
            return redirect('signup')
        if User.objects.filter(username=un).exists():
            messages.error(request, "Username already exists! Try another Username")
            return redirect('signup')
        if User.objects.filter(email=em).exists():
            messages.error(request, "Email already exists! Try again")
            return redirect('signup')

        User.objects.create_user(first_name=fn, last_name=ln, email=em, username=un, password=p1)
        messages.success(request, "User created successfully. Please log in.")
        return redirect('login')

    return render(request, 'signup.html')


def logout(request):
    auth.logout(request)
    messages.success(request, "You have been logged out.")
    return redirect('index')


# -------------------------
# Watchlist and rating
# -------------------------
@login_required
def watchlist(request):
    watchlist_items = WatchlistItem.objects.filter(user=request.user).order_by('-id')
    return render(request, 'watchlist.html', {'items': watchlist_items})



@require_POST
def toggle_watchlist(request):
    """
    AJAX endpoint for:
      - add: add movie to watchlist
      - remove: remove movie from watchlist
      - mark_watched: mark an existing (or newly created) watchlist item as watched=True
    Expects JSON body with: tmdb_id, title, poster_path, release_date, action
    """
    # Return JSON 401 for unauthenticated AJAX calls (don't redirect)
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required'}, status=401)

    # Parse JSON body safely
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON payload'}, status=400)

    tmdb_id = payload.get('tmdb_id')
    title = payload.get('title', '')
    poster_path = payload.get('poster_path', '')
    release_date = payload.get('release_date', None)
    action = payload.get('action')

    if not tmdb_id:
        return JsonResponse({'status': 'error', 'message': 'tmdb_id is required'}, status=400)
    if action not in ('add', 'remove', 'mark_watched'):
        return JsonResponse({'status': 'error', 'message': "action must be 'add', 'remove', or 'mark_watched'."}, status=400)

    try:
        if action == 'add':
            obj, created = WatchlistItem.objects.get_or_create(
                user=request.user,
                tmdb_id=tmdb_id,
                defaults={'title': title, 'poster_path': poster_path, 'release_date': release_date}
            )
            if created:
                return JsonResponse({'status': 'success', 'message': f'{title or "Item"} added to watchlist.'})
            else:
                return JsonResponse({'status': 'success', 'message': f'{title or "Item"} is already in your watchlist.'})

        elif action == 'remove':
            qs = WatchlistItem.objects.filter(user=request.user, tmdb_id=tmdb_id)
            if qs.exists():
                qs.delete()
                return JsonResponse({'status': 'success', 'message': f'{title or "Item"} removed from watchlist.'})
            else:
                return JsonResponse({'status': 'error', 'message': 'Item not found in watchlist.'}, status=404)

        elif action == 'mark_watched':
            # get_or_create ensures the item exists; then set watched=True
            item, created = WatchlistItem.objects.get_or_create(
                user=request.user,
                tmdb_id=tmdb_id,
                defaults={'title': title, 'poster_path': poster_path, 'release_date': release_date}
            )
            item.watched = True
            # optionally keep existing user_rating if any
            item.save()
            return JsonResponse({'status': 'success', 'message': f'{title or "Item"} marked as watched.'})

    except Exception as exc:
        logger.exception('Error in toggle_watchlist for user=%s tmdb_id=%s action=%s: %s', request.user, tmdb_id, action, exc)
        return JsonResponse({'status': 'error', 'message': 'Internal server error'}, status=500)


@require_POST
@login_required
def submit_rating(request):
    """
    Accepts JSON: { "tmdb_id": <int|string>, "rating": <int 1-5> }
    Marks the WatchlistItem as watched=True and stores user_rating.
    Returns JSON with appropriate status codes.
    """
    # 1) Parse JSON safely
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON payload'}, status=400)

    tmdb_id = payload.get('tmdb_id')
    rating = payload.get('rating')

    # 2) Validate input
    if not tmdb_id:
        return JsonResponse({'status': 'error', 'message': 'tmdb_id is required'}, status=400)
    if rating is None:
        return JsonResponse({'status': 'error', 'message': 'rating is required'}, status=400)

    try:
        rating_int = int(rating)
    except (TypeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'rating must be an integer between 1 and 5'}, status=400)

    if rating_int < 1 or rating_int > 5:
        return JsonResponse({'status': 'error', 'message': 'rating must be between 1 and 5'}, status=400)

    # 3) Persist rating (get_or_create so we always have an item to update)
    try:
        item, created = WatchlistItem.objects.get_or_create(
            user=request.user,
            tmdb_id=tmdb_id,
            defaults={'title': '', 'poster_path': '', 'release_date': None}
        )

  
        rating = int(rating)

        item = WatchlistItem.objects.get(user=request.user, tmdb_id=tmdb_id)
        item.watched = True

        # If rating > 0, save rating. If 0, only mark as watched.
        if rating > 0:
            item.user_rating = rating

        item.save()


        return JsonResponse({'status': 'success', 'message': f'Rating ({rating_int}/5) saved successfully.'})
    except Exception as exc:
        logger.exception('Error saving rating for user=%s tmdb_id=%s: %s', request.user, tmdb_id, exc)
        return JsonResponse({'status': 'error', 'message': 'Internal server error while saving rating'}, status=500)





# -------------------------
# Profile views
# -------------------------
@login_required
def profile_update(request):
    """
    Handles profile page display and profile image update.
    Uses profile_pic.objects.get_or_create(user=request.user) so we never rely on
    request.user.profile existing as a reverse attribute.
    """
    # Ensure profile_pic instance exists for this user (avoid AttributeError)
    profile, created = profile_pic.objects.get_or_create(user=request.user)

    # Handle form POST (file upload)
    if request.method == 'POST':
        p_form = ProfileUpdateForm(request.POST, request.FILES, instance=profile)
        if p_form.is_valid():
            p_form.save()
            messages.success(request, 'Your profile picture has been updated!')
            return redirect('profile')
        else:
            # Add form errors to messages so user can see them in template
            for field, errs in p_form.errors.items():
                messages.error(request, f"{field}: {' '.join(errs)}")
    else:
        p_form = ProfileUpdateForm(instance=profile)

    total_watchlist = WatchlistItem.objects.filter(user=request.user).count()
    total_ratings = WatchlistItem.objects.filter(user=request.user, user_rating__isnull=False).count()
    favorite_genre_name = "N/A"

    context = {
        'p_form': p_form,
        'profile': profile,
        'total_watchlist': total_watchlist,
        'total_ratings': total_ratings,
        'favorite_genre_name': favorite_genre_name,
    }
    return render(request, 'profile.html', context)


# Keep a small wrapper so old URL mapping to 'profile' (if any) still works.
# If your urls.py already maps 'profile/' to profile_update, you can remove this.
@login_required
def profile(request):
    return profile_update(request)



# myapp/views.py (add or replace the search view)


@require_GET
def api_search(request):
    """
    Proxy to TMDB search:
    GET /api/search/?q=...&page=1
    Returns JSON: { results: [ {id,title,poster_path,release_date,overview,vote_average}, ... ], error?: "..." }
    """
    # 1) Read & normalize inputs immediately (prevents UnboundLocalError)
    q = request.GET.get('q', '') or ''
    q = q.strip()
    page = request.GET.get('page', 1)
    try:
        page = int(page)
        if page < 1:
            page = 1
    except (TypeError, ValueError):
        page = 1

    # 2) Quick return if no query
    if not q:
        return JsonResponse({'results': []})

    # 3) Ensure API key present
    if not TMDB_API_KEY:
        return JsonResponse({'results': [], 'error': 'TMDB API key not configured on server.'}, status=500)

    # 4) Optional cache lookup (saves TMDB calls)
    cache_key = f"tmdb_search:{q}:{page}"
    cached = None
    try:
        cached = cache.get(cache_key)
    except Exception:
        # cache may not be configured; ignore cache errors
        cached = None

    if cached is not None:
        return JsonResponse({'results': cached})

    # 5) Prepare TMDB request
    tmdb_url = f"{TMDB_BASE}/search/movie"
    params = {
        'api_key': TMDB_API_KEY,
        'query': q,
        'page': page,
        'include_adult': False,
    }

    try:
        # use resilient session if available (with retries/backoff)
        if TMDB_SESSION is not None:
            resp = TMDB_SESSION.get(tmdb_url, params=params, timeout=TMDB_TIMEOUT)
        else:
            resp = requests.get(tmdb_url, params=params, timeout=TMDB_TIMEOUT)

        if resp.status_code != 200:
            # return friendly error to frontend
            return JsonResponse({'results': [], 'error': f'TMDB error (status {resp.status_code})'}, status=503)

        data = resp.json()

        results = []
        for m in data.get('results', []):
            results.append({
                'id': m.get('id'),
                'title': m.get('title') or m.get('name') or '',
                'poster_path': m.get('poster_path'),
                'release_date': m.get('release_date') or '',
                'overview': m.get('overview') or '',
                'vote_average': m.get('vote_average') or 0
            })

        # store in cache for short period (if cache available)
        try:
            cache.set(cache_key, results, timeout=60 * 3)  # 3 minutes
        except Exception:
            pass

        return JsonResponse({'results': results})

    except requests.exceptions.Timeout:
        return JsonResponse({'results': [], 'error': 'TMDB request timed out. Try again.'}, status=504)
    except requests.exceptions.RequestException as exc:
        # network / TLS error etc.
        return JsonResponse({'results': [], 'error': 'Network error contacting TMDB.'}, status=502)
    except Exception as exc:
        # fallback catch-all
        return JsonResponse({'results': [], 'error': 'Internal server error.'}, status=500)



@require_GET
def search_suggest(request):
    q = request.GET.get('q', '').strip()
    if not q or len(q) < 2:
        return JsonResponse({'results': []})

    if not TMDB_API_KEY:
        return JsonResponse({'results': [], 'error': 'TMDB API key not configured.'}, status=500)

    url = f"{TMDB_BASE}/search/movie"
    params = {
        'api_key': TMDB_API_KEY,
        'query': q,
        'page': 1,
        'include_adult': False,
    }

    try:
        resp = TMDB_SESSION.get(url, params=params, timeout=TMDB_TIMEOUT)
        if resp.status_code != 200:
            return JsonResponse({'results': []})
        data = resp.json()
        results = []
        for movie in data.get('results', [])[:6]:
            results.append({
                'id': movie.get('id'),
                'title': movie.get('title') or movie.get('name') or '',
                'release_date': movie.get('release_date') or '',
                'poster_path': movie.get('poster_path') or '',
            })
        return JsonResponse({'results': results})
    except requests.exceptions.Timeout:
        # return empty suggestions instead of 500
        return JsonResponse({'results': []})
    except requests.exceptions.RequestException:
        return JsonResponse({'results': []})




def movie_detail(request, tmdb_id):
    """
    Simple TMDB-backed movie detail page.
    """
    TMDB_BASE = getattr(settings, 'TMDB_BASE_URL', 'https://api.themoviedb.org/3')
    TMDB_KEY = getattr(settings, 'TMDB_API_KEY', None)

    movie = {}
    credits = {}
    videos = {}

    if TMDB_KEY:
        try:
            # Movie details
            resp = requests.get(f"{TMDB_BASE}/movie/{tmdb_id}", params={'api_key': TMDB_KEY, 'language': 'en-US'}, timeout=10)
            if resp.ok:
                movie = resp.json()

            # Credits (cast/crew)
            resp2 = requests.get(f"{TMDB_BASE}/movie/{tmdb_id}/credits", params={'api_key': TMDB_KEY}, timeout=10)
            if resp2.ok:
                credits = resp2.json()

            # Videos (trailers)
            resp3 = requests.get(f"{TMDB_BASE}/movie/{tmdb_id}/videos", params={'api_key': TMDB_KEY}, timeout=10)
            if resp3.ok:
                videos = resp3.json()
        except requests.RequestException:
            # Network problems — show minimal page
            movie = movie or {}
    else:
        # No API key set — show placeholder
        movie = {}

    context = {
        'movie': movie,
        'credits': credits,
        'videos': videos,
        'TMDB_IMAGE_BASE': 'https://image.tmdb.org/t/p/w500',
    }
    return render(request, 'movie_detail.html', context)


User = get_user_model()

class UserUpdateForm(forms.ModelForm):
    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'email']
        widgets = {
            'first_name': forms.TextInput(attrs={'placeholder': 'First name', 'class': 'input'}),
            'last_name': forms.TextInput(attrs={'placeholder': 'Last name', 'class': 'input'}),
            'email': forms.EmailInput(attrs={'placeholder': 'email@example.com', 'class': 'input'}),
        }

class ProfileForm(forms.ModelForm):
    class Meta:
        model = profile_pic
        # adjust fields if your model has different names
        fields = ['image']
        widgets = {
            'bio': forms.Textarea(attrs={'rows': 4, 'placeholder': 'Short bio', 'class': 'input'}),
            'location': forms.TextInput(attrs={'placeholder': 'City, Country', 'class': 'input'}),
        }




@login_required
def edit_profile(request):
    # ensure profile instance exists
    try:
        profile = request.user.profile  # expects related_name='profile'
    except profile_pic.DoesNotExist:
        profile = profile_pic.objects.create(user=request.user)

    if request.method == 'POST':
        uform = UserUpdateForm(request.POST, instance=request.user)
        pform = ProfileForm(request.POST, request.FILES, instance=profile)

        if uform.is_valid() and pform.is_valid():
            uform.save()
            pform.save()
            messages.success(request, 'Profile updated successfully.')
            return redirect('profile')  # or 'edit_profile' if you want to stay
        else:
            messages.error(request, 'Please correct the errors below.')
    else:
        uform = UserUpdateForm(instance=request.user)
        pform = ProfileForm(instance=profile)

    return render(request, 'edit_profile.html', {
        'uform': uform,
        'pform': pform,
    })
