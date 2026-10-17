import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from warehouse.app import create_app, UploadBodyLimit


class FakeServices:
    def health(self):
        return [{'name': 'Test service', 'ready': True}]


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Path(self.temp.name), FakeServices())
        self.client = TestClient(self.app)

    def tearDown(self):
        self.app.state.pipeline.executor.shutdown(wait=True)
        self.temp.cleanup()

    def test_media_cannot_escape_data_directory(self):
        self.assertEqual(self.client.get('/media/%2e%2e/README.md').status_code, 404)
        self.assertEqual(self.client.get('/media/absent.mp4').status_code, 404)

    def test_foreign_origin_cannot_start_gpu_work(self):
        response = self.client.post('/api/sample', headers={'Origin': 'https://unrelated.example'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.app.state.store.all('jobs'), [])

    def test_public_state_omits_embedding_vectors_and_track_samples(self):
        self.app.state.store.put('clips', {'id': 'c', 'vector': [1.] * 256})
        self.app.state.store.put('tracks', {'id': 't', 'samples': [{'bbox': [1, 2, 3, 4]}]})
        state = self.client.get('/api/state').json()
        self.assertNotIn('vector', state['clips'][0])
        self.assertNotIn('samples', state['tracks'][0])

    def test_identity_confirmation_requires_existing_track(self):
        response = self.client.post('/api/tracks/missing/identity', json={'worker_id': 'a', 'task': 'lifting'})
        self.assertEqual(response.status_code, 404)

    def test_recording_tracking_contains_only_its_own_tracks(self):
        store=self.app.state.store
        store.put('recordings',{'id':'r','width':1280,'height':720,'fps':30,'duration':10})
        store.put('tracks',{'id':'r-1','recording_id':'r','track_id':1,'samples':[{'time':0,'bbox':[10,20,40,90],'confidence':.9}]})
        store.put('tracks',{'id':'other-2','recording_id':'other','track_id':2,'samples':[]})
        result=self.client.get('/api/recordings/r/tracking')
        self.assertEqual(result.status_code,200)
        self.assertEqual([t['id'] for t in result.json()['tracks']],['r-1'])
        self.assertEqual(result.json()['width'],1280)
        self.assertEqual(result.json()['tracks'][0]['samples'][0]['bbox'],[10,20,40,90])
        self.assertEqual(self.client.get('/api/recordings/missing/tracking').status_code,404)

    def test_upload_rejects_non_mp4_and_missing_capture_time(self):
        response = self.client.post('/api/upload', files={'file': ('bad.txt', b'hello', 'text/plain')},
                                    data={'task': 'walking', 'captured_at': '2026-10-17T10:00:00Z'})
        self.assertEqual(response.status_code, 400)
        response = self.client.post('/api/upload', files={'file': ('a.mp4', b'x', 'video/mp4')}, data={'task': 'walking'})
        self.assertEqual(response.status_code, 422)

    def test_upload_rejects_oversized_body_before_multipart_parsing(self):
        self.app.add_middleware(UploadBodyLimit, max_bytes=100)
        response = self.client.post('/api/upload', content=b'not multipart',
                                   headers={'Content-Length': '101', 'Content-Type': 'multipart/form-data; boundary=x'})
        self.assertEqual(response.status_code, 413)
        prefix = b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.mp4"\r\nContent-Type: video/mp4\r\n\r\n'
        response = self.client.post('/api/upload', content=iter([prefix, b'x' * 120, b'\r\n--x--\r\n']),
                                   headers={'Content-Type': 'multipart/form-data; boundary=x'})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.app.state.store.all('jobs'), [])
