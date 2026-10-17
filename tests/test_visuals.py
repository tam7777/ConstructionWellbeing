import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from warehouse.app import create_app
from warehouse.visuals import crop_person, decode_pose, empty_artifact, read_artifact, save_artifact


class PoseTests(unittest.TestCase):
    def outputs(self, confidence=.9):
        landmarks = np.zeros((39, 5), dtype=np.float32)
        landmarks[:, :2] = [128, 128]
        landmarks[:, 3:] = 5
        return [landmarks.reshape(1, 195), np.array([[confidence]])]

    def test_crop_preserves_aspect_and_normalizes_rgb(self):
        frame = np.zeros((100, 200, 3), dtype=np.uint8)
        frame[:, :] = [0, 0, 255]
        blob, (left, top, side) = crop_person(frame, [50, 20, 100, 80])
        self.assertEqual(blob.shape, (1, 256, 256, 3))
        self.assertEqual(side, 72)
        self.assertEqual((left, top), (39, 14))
        np.testing.assert_array_equal(blob[0, 128, 128], [1, 0, 0])

    def test_maps_model_coordinates_to_original_video_pixels(self):
        result = decode_pose(self.outputs(), (40, 10, 100), [50, 20, 120, 100], 200, 100)
        self.assertEqual(len(result['keypoints']), 33)
        self.assertEqual(result['keypoints'][0][:2], [90, 60])
        self.assertGreater(result['keypoints'][11][2], .99)

    def test_rejects_low_confidence_occlusion_and_wrong_track(self):
        args = ((40, 10, 100), [50, 20, 120, 100], 200, 100)
        self.assertIsNone(decode_pose(self.outputs(.3), *args))
        outputs = self.outputs()
        outputs[0].reshape(39, 5)[[11, 12, 23, 24], 3:] = -6
        self.assertIsNone(decode_pose(outputs, *args))
        self.assertIsNone(decode_pose(self.outputs(), (40, 10, 100), [0, 0, 20, 20], 200, 100))

    def test_out_of_frame_joints_have_zero_confidence(self):
        outputs = self.outputs()
        outputs[0].reshape(39, 5)[15, :2] = [-500, 128]
        result = decode_pose(outputs, (40, 10, 100), [50, 20, 120, 100], 200, 100)
        self.assertEqual(result['keypoints'][15][2], 0)

    def test_artifact_is_per_recording_and_missing_is_explicit(self):
        recording = dict(id='r', media_path='r/normalized.mp4', width=200, height=100)
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(read_artifact(root, recording)['status'], 'missing')
            artifact = empty_artifact(recording, 'ready')
            save_artifact(root, recording, artifact)
            self.assertEqual(read_artifact(root, recording), artifact)
            self.assertTrue((Path(root) / 'r' / 'visuals.json').is_file())


class PoseApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = create_app(self.root, services=object())
        self.client = TestClient(self.app)
        self.recording = dict(id='r', media_path='r/normalized.mp4', width=200, height=100,
                              duration=2, fps=30, status='ready')
        self.app.state.store.put('recordings', self.recording)

    def tearDown(self):
        self.app.state.pipeline.executor.shutdown(wait=True)
        self.temp.cleanup()

    def test_get_missing_and_ready_artifacts_without_bulk_state_data(self):
        self.assertEqual(self.client.get('/api/recordings/absent/visuals').status_code, 404)
        self.assertEqual(self.client.get('/api/recordings/r/visuals').json()['status'], 'missing')
        artifact = empty_artifact(self.recording, 'ready')
        artifact['tracks'] = [{'id': 'r-1', 'samples': [{'time': 0, 'keypoints': [[1, 2, .9]] * 33}]}]
        save_artifact(self.root, self.recording, artifact)
        self.assertEqual(self.client.get('/api/recordings/r/visuals').json(), artifact)
        self.assertNotIn('keypoints', str(self.client.get('/api/state').json()))

    def test_post_queues_generation_and_uses_only_this_recordings_tracks(self):
        store = self.app.state.store
        store.put('tracks', {'id': 'r-1', 'recording_id': 'r', 'track_id': 1, 'samples': []})
        store.put('tracks', {'id': 'other-2', 'recording_id': 'other', 'samples': []})
        self.assertEqual(self.client.post('/api/recordings/absent/visuals').status_code, 404)
        def generate(root, recording, tracks, **kwargs):
            self.assertEqual([t['id'] for t in tracks], ['r-1'])
            artifact = empty_artifact(recording, 'ready')
            artifact['statistics'] = {'accepted': 0}
            return save_artifact(root, recording, artifact)
        with patch('warehouse.pipeline.visuals.generate_artifact', side_effect=generate):
            response = self.client.post('/api/recordings/r/visuals')
            self.assertEqual(response.status_code, 202)
            self.app.state.pipeline.future.result(timeout=5)
        self.assertEqual(store.get('jobs', response.json()['id'])['status'], 'completed')
        self.assertEqual(self.client.get('/api/recordings/r/visuals').json()['status'], 'ready')

    def test_pose_failure_preserves_successful_evidence_recording(self):
        with patch('warehouse.pipeline.visuals.generate_artifact', side_effect=RuntimeError('DNN unavailable')):
            response = self.client.post('/api/recordings/r/visuals')
            self.app.state.pipeline.future.result(timeout=5)
        self.assertEqual(self.app.state.store.get('recordings', 'r')['status'], 'ready')
        self.assertEqual(self.app.state.store.get('jobs', response.json()['id'])['status'], 'failed')
        self.assertEqual(self.client.get('/api/recordings/r/visuals').json()['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
