import unittest
from unittest.mock import Mock, patch

import requests
from app import create_app

PATH = '/api/appointments/12345678-1234-1234-1234-123456789abc/analysis'
HEADERS = {'Authorization': 'Bearer user-token'}


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({'TESTING': True, 'SUPABASE_URL': 'https://example.supabase.co',
                               'SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_example'})
        self.client = self.app.test_client()

    def test_serves_interface_and_assets(self):
        for path in ['/', '/styles.css', '/app.js', '/cloud.js', '/analysis.js']:
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_does_not_serve_private_files(self):
        for path in ['/.env', '/app.py', '/requirements.txt', '/supabase/schema.sql', '/.git/config']:
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_public_config(self):
        with self.client.get('/config.js') as response:
            self.assertIn('sb_publishable_example', response.text)
            self.assertNotIn('OPENROUTER', response.text)

    @patch('app.requests.post')
    def test_requires_session(self, post):
        self.assertEqual(self.client.post(PATH, json={}).status_code, 401)
        post.assert_not_called()

    @patch('app.requests.post')
    def test_validates_input(self, post):
        for body in [None, [], {'regenerate': 'yes'}]:
            self.assertEqual(self.client.post(PATH, json=body, headers=HEADERS).status_code, 400)
        post.assert_not_called()

    @patch('app.requests.post')
    def test_proxies_only_id_and_regenerate_with_user_jwt(self, post):
        post.return_value = Mock(ok=True, status_code=200, json=lambda: {'summary': 'saved'})
        response = self.client.post(PATH, json={'regenerate': True, 'report': 'untrusted'}, headers=HEADERS)
        self.assertEqual(response.json, {'summary': 'saved'})
        kwargs = post.call_args.kwargs
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer user-token')
        self.assertEqual(kwargs['json'], {'appointmentId': PATH.split('/')[3], 'regenerate': True})
        self.assertEqual(kwargs['timeout'], (5, 55))

    @patch('app.requests.post')
    def test_upstream_session_error_is_friendly(self, post):
        post.return_value = Mock(ok=False, status_code=401)
        response = self.client.post(PATH, json={}, headers=HEADERS)
        self.assertEqual(response.status_code, 401)
        self.assertIn('sessão', response.json['error'])

    @patch('app.requests.post')
    def test_keeps_rate_limit(self, post):
        post.return_value = Mock(ok=False, status_code=429, json=lambda: {'error': 'Aguarde.'})
        self.assertEqual(self.client.post(PATH, json={}, headers=HEADERS).status_code, 429)

    @patch('app.requests.post', side_effect=requests.Timeout('private details'))
    def test_timeout_does_not_expose_exception(self, _post):
        response = self.client.post(PATH, json={}, headers=HEADERS)
        self.assertEqual(response.status_code, 504)
        self.assertNotIn('private', response.text)

    @patch('app.requests.post', side_effect=requests.ConnectionError('private details'))
    def test_connection_error(self, _post):
        self.assertEqual(self.client.post(PATH, json={}, headers=HEADERS).status_code, 502)

    @patch('app.requests.post')
    def test_payload_limit(self, post):
        self.assertEqual(self.client.post(PATH, json={'x': 'a' * 3000}, headers=HEADERS).status_code, 413)
        post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
