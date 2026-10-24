"""Turns the atlas feature matrix into layouts, clusters, labels, and the files the site reads."""

import time


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)
