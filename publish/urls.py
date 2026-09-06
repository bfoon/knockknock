from django.urls import path

from . import views
from .feeds import PublicationFeed

app_name = "publish"

urlpatterns = [
    # index
    path("", views.FeedView.as_view(), name="feed"),
    path("feed.atom", PublicationFeed(), name="atom"),
    path("oembed/", views.OEmbedView.as_view(), name="oembed"),

    # studio (before the slug catch-all)
    path("studio/", views.StudioView.as_view(), name="studio"),
    path("studio/new/", views.NewView.as_view(), name="new"),
    path("studio/sources/<slug:kind>/", views.SourceListView.as_view(), name="sources"),
    path("studio/<uuid:pk>/", views.EditView.as_view(), name="edit"),
    path("studio/<uuid:pk>/figure/", views.BlockImageView.as_view(), name="figure"),
    path("studio/<uuid:pk>/<slug:action>/", views.ActionView.as_view(), name="action"),

    # review
    path("review/", views.ReviewQueueView.as_view(), name="review"),

    # reader
    path("<slug:slug>/", views.DetailView.as_view(), name="detail"),
    path("<slug:slug>/embed/", views.EmbedView.as_view(), name="embed"),
    path("<slug:slug>/player/", views.PlayerView.as_view(), name="player"),
    path("<slug:slug>/og.png", views.OgImageView.as_view(), name="og"),
    path("<slug:slug>/qr.png", views.QrView.as_view(), name="qr"),
    path("<slug:slug>/cite.<slug:fmt>", views.CiteView.as_view(), name="cite"),
    path("<slug:slug>/download/<uuid:asset_id>/", views.DownloadView.as_view(), name="download"),
    path("<slug:slug>/share/<slug:channel>/", views.ShareView.as_view(), name="share"),
]
