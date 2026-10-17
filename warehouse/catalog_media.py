"""Real previews for known files in the VM's read-only video catalog."""
import subprocess
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

_thumbnail_lock=threading.Lock()


def ensure_thumbnail(source,destination):
    destination=Path(destination)
    if destination.is_file():
        return destination
    with _thumbnail_lock:
        if destination.is_file():return destination
        destination.parent.mkdir(parents=True,exist_ok=True)
        temporary=destination.with_name(destination.stem+'.tmp.jpg')
        try:
            subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                '-threads','1','-ss','0.5','-i',str(source),'-frames:v','1',
                '-vf','scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2',
                '-filter_threads','1','-threads','1',str(temporary)],
                check=True,capture_output=True,timeout=30)
            temporary.replace(destination)
        except (OSError,subprocess.SubprocessError):
            temporary.unlink(missing_ok=True)
            raise ValueError('Video preview unavailable.') from None
    return destination


def create_router(library,root):
    router=APIRouter()
    def source_for(identifier):
        source=library.resolve(identifier)
        if source is None:raise HTTPException(404,'Dataset video not found.')
        return source

    @router.get('/api/library/{identifier}/video')
    def video(identifier:str):
        return FileResponse(source_for(identifier),media_type='video/mp4')

    @router.get('/api/library/{identifier}/thumbnail')
    def thumbnail(identifier:str):
        source=source_for(identifier)
        try:
            output=ensure_thumbnail(source,Path(root)/'library-thumbnails'/f'{identifier}.jpg')
        except ValueError:
            raise HTTPException(503,'Video preview unavailable.') from None
        return FileResponse(output,media_type='image/jpeg',headers={'Cache-Control':'public, max-age=3600'})
    return router
