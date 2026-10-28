"""Make projector-friendly copies of uploaded slide videos (hanns/video.py).

    python manage.py hanns_video_worker          # run forever (a compose service)
    python manage.py hanns_video_worker --once   # empty the queue, then exit (cron)
"""
import signal
import time

from django.core.management.base import BaseCommand

from hanns import video as hv


class Command(BaseCommand):
    help = "Convert uploaded slide videos to a 1080p H.264 screen copy, one at a time."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process what's queued, then exit.")
        parser.add_argument("--poll", type=float, default=3.0, help="Seconds between queue checks.")

    def handle(self, *args, once=False, poll=3.0, **opts):
        if not hv.available():
            self.stderr.write("ffmpeg/ffprobe not found (or media isn't on local disk): nothing to do.")
            if once:
                return
        stop = {"now": False}
        signal.signal(signal.SIGTERM, lambda *_: stop.__setitem__("now", True))
        self.stdout.write("Hanns video worker: watching the queue.")
        last_sweep = 0
        while not stop["now"]:
            hv.heartbeat()                                    # uploads see a live worker and leave it the job
            if time.time() - last_sweep > 600:
                last_sweep = time.time()
                n = hv.requeue_stale()
                if n:
                    self.stdout.write(f"re-queued {n} interrupted job(s)")
            ids = hv.pending()
            for vid in ids:
                if stop["now"]:
                    break
                meta = hv.process_one(vid)
                if meta:
                    self.stdout.write(f"{vid}: {meta['status']}" + (f" ({meta['error']})" if meta.get("error") else ""))
                hv.heartbeat()
            if once and not hv.pending():
                break
            if not ids:
                time.sleep(poll)
