from fastapi import FastAPI
from fastapi.testclient import TestClient
from warehouse.library import VideoLibrary
from warehouse.catalog_media import create_router


def test_preview_serves_only_known_video_and_preserves_byte_ranges(tmp_path):
    library_root=tmp_path/'library'
    library_root.mkdir()
    (library_root/'clip.mp4').write_bytes(b'actual-test-video')
    library=VideoLibrary(library_root)
    app=FastAPI();app.include_router(create_router(library,tmp_path/'data'))
    client=TestClient(app)
    identifier=library.items()[0]['id']
    response=client.get(f'/api/library/{identifier}/video',headers={'Range':'bytes=0-5'})
    assert response.status_code==206
    assert response.content==b'actual'
    assert response.headers['content-type']=='video/mp4'
    assert client.get('/api/library/unknown/video').status_code==404
    assert client.get('/api/library/unknown/thumbnail').status_code==404
