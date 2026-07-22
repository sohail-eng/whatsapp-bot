#!/usr/bin/env python3
"""Quick test harness for searching/downloading via yt-dlp."""

from __future__ import annotations

import argparse
import json
import os
import sys
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4
import time

try:
    from yt_dlp import YoutubeDL
except ImportError as exc:  # pragma: no cover
    raise RuntimeError(
        "Missing dependency `yt-dlp`. Install it with `python -m pip install yt-dlp`."
    ) from exc


def _is_tiktok_url(url: str) -> bool:
    """Check if the URL is a TikTok URL."""
    tiktok_domains = ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "www.tiktok.com"]
    return any(domain in url.lower() for domain in tiktok_domains)


def _is_facebook_url(url: str) -> bool:
    """Check if the URL is a Facebook URL (reels, videos, etc.)."""
    facebook_domains = ["facebook.com", "fb.com", "fb.watch", "m.facebook.com"]
    return any(domain in url.lower() for domain in facebook_domains)


def _is_instagram_url(url: str) -> bool:
    """Check if the URL is an Instagram URL (reels, videos, etc.)."""
    instagram_domains = ["instagram.com", "instagr.am"]
    return any(domain in url.lower() for domain in instagram_domains)


def _configure_cookies(ydl_opts: dict) -> None:
    """Configure optional yt-dlp authentication from environment variables."""
    cookies_file = os.environ.get("YTDLP_COOKIES_FILE")
    cookies_browser = os.environ.get("YTDLP_COOKIES_FROM_BROWSER")

    # Prefer an exported cookies file when both are set — more reliable while Chrome is open.
    if cookies_file:
        cookie_path = Path(cookies_file).expanduser()
        if not cookie_path.is_file():
            raise RuntimeError(f"YTDLP_COOKIES_FILE does not exist: {cookie_path}")
        ydl_opts.pop("cookiesfrombrowser", None)
        ydl_opts["cookiefile"] = str(cookie_path)
        return

    if cookies_browser:
        browser = cookies_browser.strip().lower()
        if not browser:
            raise RuntimeError("YTDLP_COOKIES_FROM_BROWSER cannot be empty")
        ydl_opts.pop("cookiefile", None)
        # Optional profile: YTDLP_COOKIES_FROM_BROWSER=chrome:Default
        if ":" in browser:
            name, profile = browser.split(":", 1)
            ydl_opts["cookiesfrombrowser"] = (name, profile, None, None)
        else:
            ydl_opts["cookiesfrombrowser"] = (browser,)


def _has_cookie_configuration() -> bool:
    return bool(
        os.environ.get("YTDLP_COOKIES_FILE")
        or os.environ.get("YTDLP_COOKIES_FROM_BROWSER")
    )


def _is_youtube_bot_challenge(error: BaseException) -> bool:
    msg = str(error).lower()
    return any(
        needle in msg
        for needle in (
            "sign in to confirm",
            "not a bot",
            "confirm you",
            "login required",
            "cookies-from-browser",
        )
    )


def _apply_youtube_cookie_retry_opts(ydl_opts: dict) -> None:
    """Attach cookies and use clients/formats that work better after a bot wall."""
    _configure_cookies(ydl_opts)
    ydl_opts["format"] = "bestaudio/best/ba/b"
    ydl_opts["extractor_args"] = {
        "youtube": {
            "player_client": ["tv", "android", "web"],
        }
    }


def _convert_video_to_whatsapp_format(input_path: Path, output_path: Path) -> bool:
    """
    Convert video to WhatsApp-compatible format (H.264/AAC MP4).
    Optimized for file size to stay under WhatsApp's 16MB limit.
    
    Args:
        input_path: Path to input video file
        output_path: Path to output video file (will be overwritten)
    
    Returns:
        True if conversion successful, False otherwise
    """
    try:
        # FFmpeg command to convert to WhatsApp-compatible format
        # H.264 video codec, AAC audio codec, MP4 container
        # Optimized for smaller file size while maintaining reasonable quality
        # Scale filter: first scale to max dimensions, then ensure even dimensions (required for H.264)
        cmd = [
            "ffmpeg",
            "-i", str(input_path),
            "-c:v", "libx264",      # H.264 video codec (WhatsApp compatible)
            "-c:a", "aac",          # AAC audio codec (WhatsApp compatible)
            "-preset", "fast",      # Fast encoding
            "-crf", "28",           # Higher CRF = smaller file (28 is good balance)
            "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'",  # Max 1280x720, ensure even dimensions
            "-b:a", "128k",         # Audio bitrate (lower = smaller file)
            "-movflags", "+faststart",  # Web optimization
            "-pix_fmt", "yuv420p",  # Ensure pixel format compatibility
            "-y",                   # Overwrite output file
            str(output_path),
        ]
        
        # Run FFmpeg conversion
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
        )
        
        # Verify output file exists and has content
        if output_path.exists() and output_path.stat().st_size > 0:
            return True
        else:
            print(f"Warning: Conversion completed but output file is missing or empty")
            return False
            
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg conversion error: {e.stderr}")
        return False
    except FileNotFoundError:
        print("Error: FFmpeg not found. Please install FFmpeg to convert videos.")
        return False
    except Exception as e:
        print(f"Unexpected error during video conversion: {e}")
        return False


def _convert_video_to_whatsapp_format_aggressive(input_path: Path, output_path: Path) -> bool:
    """
    Aggressively convert video to WhatsApp-compatible format with maximum compression.
    Used when normal conversion results in file too large.
    
    Args:
        input_path: Path to input video file
        output_path: Path to output video file (will be overwritten)
    
    Returns:
        True if conversion successful, False otherwise
    """
    try:
        # More aggressive compression settings
        cmd = [
            "ffmpeg",
            "-i", str(input_path),
            "-c:v", "libx264",      # H.264 video codec
            "-c:a", "aac",          # AAC audio codec
            "-preset", "fast",      # Fast encoding
            "-crf", "32",           # Higher CRF = much smaller file (lower quality)
            "-vf", "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'",  # Max 854x480, ensure even dimensions
            "-b:a", "96k",          # Lower audio bitrate
            "-movflags", "+faststart",
            "-pix_fmt", "yuv420p",
            "-y",
            str(output_path),
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
        )
        
        if output_path.exists() and output_path.stat().st_size > 0:
            return True
        else:
            return False
            
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg aggressive conversion error: {e.stderr}")
        return False
    except FileNotFoundError:
        print("Error: FFmpeg not found. Please install FFmpeg to convert videos.")
        return False
    except Exception as e:
        print(f"Unexpected error during aggressive video conversion: {e}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Search YouTube and download a single audio track via yt-dlp, or download TikTok/Facebook/Instagram videos."
    )
    parser.add_argument(
        "query",
        nargs="?",
        default="kya baat hai",
        help="YouTube search query or full URL to download (supports YouTube, TikTok, Facebook, and Instagram).",
    )
    parser.add_argument(
        "--machine",
        action="store_true",
        help="Emit a single JSON line with the downloaded path when used from other scripts.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory where the downloaded file will land.",
    )
    parser.add_argument(
        "--tiktok",
        action="store_true",
        help="Force TikTok mode (auto-detected if URL contains tiktok.com).",
    )
    parser.add_argument(
        "--facebook",
        action="store_true",
        help="Force Facebook mode (auto-detected if URL contains facebook.com).",
    )
    parser.add_argument(
        "--instagram",
        action="store_true",
        help="Force Instagram mode (auto-detected if URL contains instagram.com).",
    )
    args = parser.parse_args()

    # Determine if this is a TikTok, Facebook, or Instagram download
    is_tiktok = args.tiktok or (args.query.startswith("http") and _is_tiktok_url(args.query))
    is_facebook = args.facebook or (args.query.startswith("http") and _is_facebook_url(args.query))
    is_instagram = args.instagram or (args.query.startswith("http") and _is_instagram_url(args.query))
    is_video = is_tiktok or is_facebook or is_instagram
    
    # Set default output directory based on type
    if args.output_dir is None:
        if is_tiktok:
            prefix = "tiktok"
        elif is_facebook:
            prefix = "facebook"
        elif is_instagram:
            prefix = "instagram"
        else:
            prefix = "yt"
        args.output_dir = Path(f"downloads/{prefix}-{str(uuid4())}")
    
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Set target URL/search query
    if is_tiktok:
        if not args.query.startswith("http"):
            print("Error: TikTok downloads require a full URL.")
            return 1
        target = args.query
    elif is_facebook:
        if not args.query.startswith("http"):
            print("Error: Facebook downloads require a full URL.")
            return 1
        target = args.query
    elif is_instagram:
        if not args.query.startswith("http"):
            print("Error: Instagram downloads require a full URL.")
            return 1
        target = args.query
    else:
        target = f"ytsearch1:{args.query}" if not args.query.startswith("http") else args.query
    
    # Use UUID for filename to avoid filesystem errors with long titles
    # Keep title in metadata for display purposes
    unique_filename = str(uuid4())
    outtmpl = str(args.output_dir / f"{unique_filename}.%(ext)s")
    quiet = args.machine
    
    # Configure yt-dlp options based on content type
    if is_tiktok:
        # TikTok: download video (will be converted to WhatsApp format after download)
        ydl_opts = {
            "format": "best[ext=mp4]/best",
            "outtmpl": outtmpl,
            "quiet": quiet,
            "no_warnings": quiet,
            "no_progress": quiet,
            "progress_hooks": [] if quiet else [lambda status: _print_progress(status)],
        }
        max_size_bytes = 50 * 1024 * 1024  # 50 MB for videos
        invalid_file = Path("invalid_video.mp4")
    elif is_facebook:
        # Facebook: download video (will be converted to WhatsApp format after download)
        ydl_opts = {
            "format": "best",
            "merge_output_format": "mp4",
            "outtmpl": outtmpl,
            "quiet": quiet,
            "no_warnings": quiet,
            "no_progress": quiet,
            "progress_hooks": [] if quiet else [lambda status: _print_progress(status)],
        }
        max_size_bytes = 50 * 1024 * 1024  # 50 MB for videos
        invalid_file = Path("invalid_video.mp4")
    elif is_instagram:
        # Instagram: download video (will be converted to WhatsApp format after download)
        ydl_opts = {
            "format": "best",
            "outtmpl": outtmpl,
            "quiet": quiet,
            "no_warnings": quiet,
            "no_progress": quiet,
            "progress_hooks": [] if quiet else [lambda status: _print_progress(status)],
        }
        max_size_bytes = 50 * 1024 * 1024  # 50 MB for videos
        invalid_file = Path("invalid_video.mp4")
    else:
        # YouTube: extract audio (mp3 format)
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": outtmpl,
            "noplaylist": True,
            "quiet": quiet,
            "no_warnings": quiet,
            "no_progress": quiet,
            "progress_hooks": [] if quiet else [lambda status: _print_progress(status)],
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ],
        }
        max_size_bytes = 15 * 1024 * 1024  # 15 MB for audio
        invalid_file = Path("invalid_song.mp3")

    if is_tiktok:
        content_type = "TikTok video"
    elif is_facebook:
        content_type = "Facebook video"
    elif is_instagram:
        content_type = "Instagram video"
    else:
        content_type = "YouTube audio"
    print(f"Downloading {content_type} '{args.query}' -> {args.output_dir}")
    tries = 0
    max_tries = 3
    info = None
    tried_cookies = False
    # Never attach cookies on the first attempt — only after a bot/sign-in challenge.
    while tries < max_tries:
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(target, download=True)
                break
        except Exception as e:
            print(f"Error downloading: {e}", file=sys.stderr)
            if not is_video and _is_youtube_bot_challenge(e):
                if not tried_cookies and _has_cookie_configuration():
                    try:
                        _apply_youtube_cookie_retry_opts(ydl_opts)
                    except RuntimeError as cookie_error:
                        print(f"Unable to configure YouTube cookies: {cookie_error}", file=sys.stderr)
                        return 1
                    tried_cookies = True
                    print(
                        "YouTube requested sign-in; retrying with "
                        f"YTDLP_COOKIES_FROM_BROWSER/YTDLP_COOKIES_FILE "
                        f"(browser={os.environ.get('YTDLP_COOKIES_FROM_BROWSER')!r}).",
                        file=sys.stderr,
                    )
                    continue

                if tried_cookies:
                    print(
                        "YouTube still blocked after cookie retry. "
                        "Make sure you are logged into YouTube in that browser, "
                        "or export cookies to YTDLP_COOKIES_FILE.",
                        file=sys.stderr,
                    )
                else:
                    print(
                        "YouTube requires cookies. Set YTDLP_COOKIES_FROM_BROWSER=chrome "
                        "or YTDLP_COOKIES_FILE.",
                        file=sys.stderr,
                    )
                return 1

            # After cookies, a bare "format not available" often means the bot wall
            # still blocked extraction — retry once more with cookies if we haven't.
            if (
                not is_video
                and not tried_cookies
                and _has_cookie_configuration()
                and "requested format is not available" in str(e).lower()
            ):
                try:
                    _apply_youtube_cookie_retry_opts(ydl_opts)
                except RuntimeError as cookie_error:
                    print(f"Unable to configure YouTube cookies: {cookie_error}", file=sys.stderr)
                    return 1
                tried_cookies = True
                print(
                    "Format unavailable; retrying YouTube download with configured cookies.",
                    file=sys.stderr,
                )
                continue

            tries += 1
            if tries < max_tries:
                time.sleep(1)
            else:
                print(f"Failed to download after {max_tries} attempts.", file=sys.stderr)
                return 1

    if info is None:
        print("Error: Failed to extract video/audio information.")
        return 1

    downloaded_file = _resolve_downloaded_file(info, args.output_dir)
    if downloaded_file is None or not downloaded_file.exists():
        print("Error: Could not find the downloaded file.")
        return 1
    
    if downloaded_file.stat().st_size > max_size_bytes:
        downloaded_file.unlink(missing_ok=True)
        destination_file = invalid_file

    else:
        # For TikTok, Facebook, and Instagram videos, convert to WhatsApp-compatible format (H.264/AAC)
        if is_video:
            print("Converting video to WhatsApp-compatible format (H.264/AAC)...")
            # Create temporary output path for conversion (keep same name)
            temp_output = downloaded_file.parent / f"temp_{downloaded_file.name}"
            
            # Convert video
            if _convert_video_to_whatsapp_format(downloaded_file, temp_output):
                # Check if converted file is within size limit
                converted_size = temp_output.stat().st_size
                if converted_size > max_size_bytes:
                    print(f"Warning: Converted video ({converted_size / (1024*1024):.2f}MB) exceeds size limit ({max_size_bytes / (1024*1024):.2f}MB)")
                    print("Trying more aggressive compression...")
                    # Try with even more compression
                    temp_output2 = downloaded_file.parent / f"temp2_{downloaded_file.name}"
                    if _convert_video_to_whatsapp_format_aggressive(downloaded_file, temp_output2):
                        if temp_output2.stat().st_size <= max_size_bytes:
                            temp_output.unlink(missing_ok=True)
                            temp_output = temp_output2
                        else:
                            temp_output2.unlink(missing_ok=True)
                
                # Replace original with converted file
                downloaded_file.unlink(missing_ok=True)
                # Rename temp file back to original name
                temp_output.rename(downloaded_file)
                final_size_mb = downloaded_file.stat().st_size / (1024 * 1024)
                print(f"Video converted successfully! Final size: {final_size_mb:.2f}MB")
            else:
                print("Warning: Video conversion failed, using original file (may not be WhatsApp compatible)")
                temp_output.unlink(missing_ok=True)
        
        # Save videos in appropriate folders, YouTube audio in downloads/
        if is_tiktok:
            final_dir = Path("downloads/tiktok")
        elif is_facebook:
            final_dir = Path("downloads/facebook")
        elif is_instagram:
            final_dir = Path("downloads/instagram")
        else:
            final_dir = Path("downloads")
        final_dir.mkdir(parents=True, exist_ok=True)
        # Use UUID for final filename to avoid filesystem errors with long titles
        file_ext = downloaded_file.suffix
        final_filename = f"{unique_filename}{file_ext}"
        destination_file = final_dir / final_filename
        shutil.move(str(downloaded_file), str(destination_file))

        try:
            shutil.rmtree(args.output_dir)
        except Exception as e:
            print(f"Warning: Could not remove {args.output_dir}: {e}")

    if args.machine:
        payload = {
            "path": str(destination_file),
            "title": info.get("title") or info.get("id") or args.query,
            "ext": destination_file.suffix.lstrip("."),
            "requested": args.query,
        }
        print("THIS_JSON_OUTPUT_START")
        print(json.dumps(payload))
        print("THIS_JSON_OUTPUT_END")
    else:
        print(f"File ready: {destination_file}")

    return 0


def _print_progress(status: dict) -> None:
    if status.get("status") == "downloading":
        downloaded = status.get("downloaded_bytes", 0)
        total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
        sys.stdout.write(
            f"\rDownloaded {downloaded // 1024}KiB / {total // 1024 if total else '?'}KiB"
        )
        sys.stdout.flush()
    elif status.get("status") == "finished":
        print("\nDownload complete.")


def _resolve_downloaded_file(info: dict, output_dir: Path) -> Path | None:
    if "requested_downloads" in info:
        candidates = [
            Path(d["filepath"]) for d in info["requested_downloads"] if d.get("filepath")
        ]
    else:
        candidates = list(output_dir.glob("*"))

    return next((path for path in candidates if path.exists()), None)


if __name__ == "__main__":
    raise SystemExit(main())
