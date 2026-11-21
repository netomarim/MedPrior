"""Servidor local e API do MedPrior. Inicie com python app.py."""
import json
import os
import re
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_from_directory

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

    return app


app = create_app()

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.getenv('PORT', '3000')), debug=False)
