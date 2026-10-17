from warehouse.library import VideoLibrary
from warehouse.core import retrieve


def test_library_only_exposes_local_mp4s_and_opaque_known_ids(tmp_path):
    root = tmp_path / 'library'
    (root / 'construction-posture/walking').mkdir(parents=True)
    source = root / 'construction-posture/walking/person.mp4'
    source.write_bytes(b'video')
    (root / 'metadata.json').write_text('{}')
    outside = tmp_path / 'outside.mp4'
    outside.write_bytes(b'outside')
    (root / 'escape.mp4').symlink_to(outside)
    library = VideoLibrary(root)
    rows = library.items()
    assert len(rows) == 1
    assert rows[0]['collection'] == 'Construction'
    assert library.resolve(rows[0]['id']) == source
    assert library.resolve('../../outside.mp4') is None
    assert library.resolve('unknown') is None


def test_unknown_capture_time_cannot_create_cross_session_history():
    query = dict(id='q', recording_id='r2', track_id=1, task='construction',
                 worker_id='a', identity_confirmed=True, capture_time_known=False,
                 started_at=8, ended_at=10, vector=[1.] + [0.] * 255)
    earlier = dict(query, id='earlier', recording_id='r1', started_at=0, ended_at=2)
    assert retrieve(query, [earlier]) == []
    earlier['recording_id'] = 'r2'
    assert len(retrieve(query, [earlier])) == 1


def test_api_catalog_and_unknown_id_do_not_start_work(tmp_path):
    from fastapi.testclient import TestClient
    from warehouse.app import create_app
    library = tmp_path / 'library'
    library.mkdir()
    (library / 'clip.mp4').write_bytes(b'video')
    app = create_app(root=tmp_path / 'app', services=object(), library_root=library)
    try:
        client = TestClient(app)
        assert len(client.get('/api/library').json()['videos']) == 1
        assert client.post('/api/library/unknown/analyse').status_code == 404
        assert app.state.store.all('jobs') == []
    finally:
        app.state.pipeline.executor.shutdown(wait=True)
