"""Servidor local e API do MedPrior. Inicie com python app.py."""
import json
import os
import re
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_from_directory, send_file
from reports import build_appointment_pdf

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')


def create_app(test_config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        MAX_CONTENT_LENGTH=2048,
        SUPABASE_URL=os.getenv('SUPABASE_URL', '').rstrip('/'),
        SUPABASE_PUBLISHABLE_KEY=os.getenv('SUPABASE_PUBLISHABLE_KEY', ''),
    )
    if test_config:
        app.config.update(test_config)

    @app.after_request
    def response_headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify(error='Solicitação muito grande.'), 413

    @app.get('/')
    def index():
        return send_from_directory(ROOT, 'index.html')

    @app.get('/config.js')
    def public_config():
        # Somente a chave pública é enviada ao navegador.
        config = {'supabaseUrl': app.config['SUPABASE_URL'],
                  'supabasePublishableKey': app.config['SUPABASE_PUBLISHABLE_KEY']}
        return Response('window.MEDPRIOR_CONFIG = ' + json.dumps(config) + ';',
                        mimetype='text/javascript')

    @app.get('/<filename>')
    def asset(filename):
        if filename not in {'index.html', 'styles.css', 'app.js', 'cloud.js', 'analysis.js'}:
            return '', 404
        return send_from_directory(ROOT, filename)

    @app.post('/api/appointments/<uuid:appointment_id>/analysis')
    def analyze(appointment_id):
        authorization = request.headers.get('Authorization', '')
        if not re.fullmatch(r'Bearer\s+\S+', authorization, flags=re.I):
            return jsonify(error='Entre novamente para gerar a ficha.'), 401
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get('regenerate', False), bool):
            return jsonify(error='Solicitação inválida.'), 400
        url = app.config['SUPABASE_URL']
        key = app.config['SUPABASE_PUBLISHABLE_KEY']
        if not url or not key:
            return jsonify(error='Configure o Supabase no arquivo .env do servidor.'), 503
        try:
            # A função valida o JWT e aplica RLS. Não usamos service_role.
            upstream = requests.post(
                url + '/functions/v1/summarize-appointment',
                headers={'Authorization': authorization, 'apikey': key},
                json={'appointmentId': str(appointment_id), 'regenerate': body.get('regenerate', False)},
                timeout=(5, 55),
            )
            if upstream.status_code == 401:
                return jsonify(error='Sua sessão expirou. Entre novamente.'), 401
            data = upstream.json()
            if upstream.ok and isinstance(data.get('summary'), str):
                return jsonify(summary=data['summary'])
            if upstream.status_code in {400, 404, 409, 413, 422, 429, 500, 502, 503, 504}:
                message = data.get('error')
                if isinstance(message, str):
                    return jsonify(error=message), upstream.status_code
            return jsonify(error='Não foi possível acessar o serviço de IA.'), 502
        except requests.Timeout:
            return jsonify(error='A IA demorou para responder. Tente novamente.'), 504
        except (requests.RequestException, ValueError, AttributeError):
            return jsonify(error='Não foi possível acessar o serviço de IA. Tente novamente.'), 502

    @app.get('/api/appointments/<uuid:appointment_id>/pdf')
    def appointment_pdf(appointment_id):
        authorization = request.headers.get('Authorization', '')
        if not re.fullmatch(r'Bearer\s+\S+', authorization, flags=re.I):
            return jsonify(error='Entre novamente para baixar o PDF.'), 401
        url = app.config['SUPABASE_URL']
        key = app.config['SUPABASE_PUBLISHABLE_KEY']
        if not url or not key:
            return jsonify(error='Configure o Supabase no .env do servidor.'), 503
        headers = {'Authorization': authorization, 'apikey': key}
        def get(path, params=None):
            result = requests.get(url + path, headers=headers, params=params, timeout=(5, 20))
            result.raise_for_status()
            return result.json()
        try:
            # Valida a sessão e consulta todas as informações sob o JWT, nunca service_role.
            user = get('/auth/v1/user')
            if not isinstance(user, dict) or not user.get('id'):
                return jsonify(error='Entre novamente para baixar o PDF.'), 401
            params = {'id': 'eq.' + str(appointment_id), 'select': '*', 'limit': '1'}
            items = get('/rest/v1/appointments', params)
            if not items:
                return jsonify(error='Atendimento não encontrado ou sem permissão.'), 404
            item = items[0]
            clinics = get('/rest/v1/clinics', {'id':'eq.' + item['clinic_id'], 'select':'id,name,active', 'limit':'1'})
            if not clinics or not clinics[0]['active']:
                return jsonify(error='Clínica inativa ou sem permissão.'), 403
            answers = get('/rest/v1/appointment_answers', {'appointment_id':'eq.' + str(appointment_id),
                          'select':'question,answer,recorded_at', 'order':'recorded_at.asc', 'limit':'40'})
            # Uma gravação durante a exportação exige nova tentativa para evitar misturar versões.
            current = get('/rest/v1/appointments', params)
            if not current or current[0]['updated_at'] != item['updated_at']:
                return jsonify(error='O atendimento mudou durante a exportação. Tente novamente.'), 409
            document = build_appointment_pdf(item, clinics[0], answers)
            return send_file(document, mimetype='application/pdf', as_attachment=True,
                             download_name=f'medprior-atendimento-{appointment_id}.pdf', max_age=0)
        except requests.HTTPError as error:
            status = error.response.status_code if error.response is not None else 502
            if status in {401,403}:
                return jsonify(error='Sessão expirada ou acesso não autorizado. Entre novamente.'), status
            return jsonify(error='Não foi possível consultar os dados para o PDF.'), 502
        except requests.Timeout:
            return jsonify(error='A consulta demorou para responder. Tente novamente.'), 504
        except (requests.RequestException, ValueError, KeyError, TypeError):
            return jsonify(error='Não foi possível gerar o PDF. Tente novamente.'), 502

    return app


app = create_app()

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.getenv('PORT', '3000')), debug=False)
