import copy
import json
import shutil
import subprocess
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

import requests

from app import create_app
from reports import build_appointment_pdf, date_label

APPOINTMENT_ID = '12345678-1234-1234-1234-123456789abc'
PATH = f'/api/appointments/{APPOINTMENT_ID}/pdf'
HEADERS = {'Authorization': 'Bearer user-token'}
ITEM = {
    'id': APPOINTMENT_ID, 'clinic_id': 'clinic-one', 'patient_label': 'Paciente Fictício 01',
    'age': 0, 'report': 'Tosse há dois dias. Nega febre.\nNariz escorrendo e leve dor de cabeça.',
    'report_source': 'patient', 'status': 'Em atendimento', 'analysis_stale': False,
    'created_at': '2026-11-21T16:00:00Z', 'updated_at': '2026-11-21T16:10:00Z',
    'ai_summary': json.dumps({'version': 2, 'facts': ['Tosse relatada.'],
        'gaps': ['Evolução não informada.'], 'questions': ['Quando começou?', 'Melhorou ou piorou?'],
        'note': 'Confirmar a evolução com o paciente.'}),
}
CLINIC = {'id': 'clinic-one', 'name': 'Clínica Fictícia', 'active': True}
ANSWERS = [{'question': 'Quando começou?', 'answer': 'Há dois dias.', 'recorded_at': '2026-11-21T16:05:00Z'}]


def result(data):
    response = Mock(status_code=200)
    response.json.return_value = data
    response.raise_for_status.return_value = None
    return response


class PdfTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app({'TESTING': True, 'SUPABASE_URL': 'https://example.supabase.co',
                                  'SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_example'}).test_client()

    @patch('app.requests.get')
    def test_requires_authentication(self, get):
        self.assertEqual(self.client.get(PATH).status_code, 401)
        get.assert_not_called()

    @patch('app.requests.get')
    def test_other_clinic_or_missing_record_returns_no_pdf(self, get):
        get.side_effect = [result({'id': 'user-one'}), result([])]
        response = self.client.get(PATH, headers=HEADERS)
        self.assertEqual(response.status_code, 404)
        self.assertNotIn('application/pdf', response.content_type)

    @patch('app.requests.get')
    def test_inactive_clinic_cannot_export(self, get):
        get.side_effect = [result({'id':'user-one'}), result([ITEM]), result([{**CLINIC, 'active':False}])]
        self.assertEqual(self.client.get(PATH, headers=HEADERS).status_code, 403)

    @patch('app.requests.get')
    def test_uses_user_jwt_and_saved_data(self, get):
        get.side_effect = [result({'id':'user-one'}), result([ITEM]), result([CLINIC]), result(ANSWERS), result([ITEM])]
        response = self.client.get(PATH, headers=HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/pdf')
        self.assertTrue(response.data.startswith(b'%PDF-'))
        self.assertIn('attachment;', response.headers['Content-Disposition'])
        self.assertIn(APPOINTMENT_ID, response.headers['Content-Disposition'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        for call in get.call_args_list:
            self.assertEqual(call.kwargs['headers']['Authorization'], 'Bearer user-token')
            self.assertEqual(call.kwargs['headers']['apikey'], 'sb_publishable_example')

    @patch('app.requests.get')
    def test_concurrent_change_rejects_inconsistent_snapshot(self, get):
        get.side_effect = [result({'id':'user-one'}), result([ITEM]), result([CLINIC]), result(ANSWERS), result([{**ITEM,'updated_at':'later'}])]
        self.assertEqual(self.client.get(PATH, headers=HEADERS).status_code, 409)

    @patch('app.requests.get', side_effect=requests.Timeout('private error'))
    def test_network_timeout(self, _get):
        response = self.client.get(PATH, headers=HEADERS)
        self.assertEqual(response.status_code, 504)
        self.assertNotIn('private', response.text)

    @patch('app.requests.get')
    def test_expired_session(self, get):
        response = Mock(status_code=401)
        get.side_effect = requests.HTTPError('private details', response=response)
        self.assertEqual(self.client.get(PATH, headers=HEADERS).status_code, 401)

    def test_timezone(self):
        self.assertEqual(date_label('2026-11-21T16:00:00Z'), '21/11/2026 às 13:00')

    @unittest.skipUnless(shutil.which('pdftotext'), 'Poppler não disponível para extração')
    def test_pdf_content_and_stale_warning(self):
        item = {**ITEM, 'analysis_stale': True}
        data = build_appointment_pdf(item, CLINIC, ANSWERS, datetime(2026,11,21,17,tzinfo=timezone.utc)).getvalue()
        extracted = subprocess.run(['pdftotext', '-', '-'], input=data, capture_output=True, check=True).stdout.decode('utf-8')
        for phrase in ['Paciente Fictício 01', 'Clínica Fictícia', '0 anos', 'Nega febre',
                       'Há dois dias.', 'Melhorou ou piorou?', 'a ficha da IA ainda não foi atualizada', 'Página 1']:
            self.assertIn(phrase, extracted)
        self.assertNotIn('service_role', extracted)

    def test_long_document_with_literal_markup_and_no_ai(self):
        item = copy.deepcopy(ITEM)
        item['report'] = '<b>Paciente</b> & relato ' * 45
        item['ai_summary'] = None
        answers = [{'question':f'Pergunta {i}?', 'answer':'Resposta extensa. ' * 27, 'recorded_at':ITEM['created_at']} for i in range(40)]
        document = build_appointment_pdf(item, CLINIC, answers).getvalue()
        self.assertTrue(document.startswith(b'%PDF-'))
        self.assertGreater(len(document), 10000)


if __name__ == '__main__':
    unittest.main()
