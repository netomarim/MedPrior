"""PDF da ficha de pré-atendimento, gerado em memória sem persistir pacientes em disco."""
import json
import re
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

BRASILIA = timezone(timedelta(hours=-3))


def date_label(value):
    if not value:
        return 'Não registrado'
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(BRASILIA).strftime('%d/%m/%Y às %H:%M')
    except (ValueError, TypeError, AttributeError):
        return 'Não registrado'


def _fonts():
    if 'MedPrior' not in pdfmetrics.getRegisteredFontNames():
        import reportlab
        fonts = Path(reportlab.__file__).parent / 'fonts'
        regular = Path('C:/Windows/Fonts/arial.ttf')
        bold = Path('C:/Windows/Fonts/arialbd.ttf')
        pdfmetrics.registerFont(TTFont('MedPrior', str(regular if regular.exists() else fonts / 'Vera.ttf')))
        pdfmetrics.registerFont(TTFont('MedPriorBold', str(bold if bold.exists() else fonts / 'VeraBd.ttf')))


def build_appointment_pdf(item, clinic, answers, generated_at=None):
    _fonts()
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm,
                                 topMargin=24*mm, bottomMargin=22*mm,
                                 title='Ficha de pré-atendimento - MedPrior', author='MedPrior')
    styles = {
        'title': ParagraphStyle('Title', fontName='MedPriorBold', fontSize=19, leading=24, spaceAfter=8),
        'subtitle': ParagraphStyle('Subtitle', fontName='MedPrior', fontSize=10, leading=15, textColor=colors.HexColor('#4d5866'), spaceAfter=12),
        'heading': ParagraphStyle('Heading', fontName='MedPriorBold', fontSize=11, leading=16, spaceBefore=15, spaceAfter=7, keepWithNext=True),
        'body': ParagraphStyle('Body', fontName='MedPrior', fontSize=10, leading=15, spaceAfter=7, alignment=TA_LEFT, splitLongWords=True),
        'small': ParagraphStyle('Small', fontName='MedPrior', fontSize=8, leading=12, textColor=colors.HexColor('#596575'), spaceAfter=7),
        'notice': ParagraphStyle('Notice', fontName='MedPrior', fontSize=9, leading=14, borderColor=colors.HexColor('#c9d0d9'), borderWidth=.6, borderPadding=9, spaceBefore=8, spaceAfter=12),
    }
    def text(value):
        clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value))
        return escape(clean).replace('\n', '<br/>')
    story = []
    def paragraph(value, style='body'):
        story.append(Paragraph(text(value), styles[style]))
    def heading(value):
        paragraph(value, 'heading')

    generated_at = generated_at or datetime.now(timezone.utc)
    paragraph('Ficha de pré-atendimento', 'title')
    paragraph('Informações para revisão pela equipe médica', 'subtitle')
    paragraph(clinic.get('name', 'Clínica'), 'heading')
    paragraph('Paciente: ' + item['patient_label'])
    age = item.get('age')
    paragraph('Idade: ' + (str(age) + ' anos' if age is not None else 'Não informada'))
    paragraph('Situação: ' + item['status'])
    priorities = {'not_assessed':'Não classificado','non_urgent':'Não urgente','low_urgency':'Pouco urgente','urgent':'Urgente','very_urgent':'Muito urgente','emergency':'Emergência'}
    paragraph('Prioridade registrada: ' + priorities.get(item.get('priority','not_assessed'),'Não classificado'))
    if item.get('priority_assessor'):
        paragraph('Classificação informada pelo profissional: ' + item['priority_assessor'], 'small')
        paragraph('Prioridade registrada em: ' + date_label(item.get('priority_recorded_at')), 'small')
    if item.get('priority_reason'):
        paragraph('Observação da classificação: ' + item['priority_reason'])
    paragraph('Registro: ' + date_label(item.get('created_at')) + ' | Emissão: ' + date_label(generated_at.isoformat()), 'small')
    paragraph('Atendimento: ' + str(item['id']), 'small')
    paragraph('Este documento reúne informações de pré-atendimento. Não contém diagnóstico, prescrição ou avaliação médica. O conteúdo deve ser conferido com o paciente.', 'notice')

    heading('1. Relato original')
    source = {'patient':'Paciente', 'companion':'Acompanhante', 'staff':'Observação da equipe'}.get(item.get('report_source'), 'Paciente')
    paragraph('Informado por: ' + source + '. Registrado pela equipe da clínica.', 'small')
    paragraph(item['report'])

    heading('2. Perguntas e respostas registradas')
    if not answers:
        paragraph('Nenhuma resposta complementar foi registrada.')
    for index, answer in enumerate(answers, 1):
        paragraph(f'{index}. ' + answer['question'], 'heading')
        paragraph('Resposta informada: ' + answer['answer'])
        paragraph('Registro pela equipe: ' + date_label(answer.get('recorded_at')), 'small')

    heading('3. Ficha consolidada e organização das informações')
    summary = item.get('ai_summary') or ''
    data = None
    try:
        candidate = json.loads(summary)
        if isinstance(candidate, dict) and candidate.get('version') in (2, 3) and all(
                isinstance(candidate.get(key), list) and all(isinstance(v, str) for v in candidate[key])
                for key in ['facts','gaps','questions']) and isinstance(candidate.get('note'), str):
            data = candidate
    except (ValueError, TypeError):
        pass
    if item.get('analysis_stale'):
        paragraph('ATENÇÃO: a ficha da IA ainda não foi atualizada com as últimas respostas. Consulte o relato original e todas as respostas acima.', 'notice')
    if data and data.get('phase') == 'complete':
        paragraph('Rodada de perguntas concluída. A ficha final foi consolidada automaticamente com o relato e as respostas apresentados acima, sem nova chamada à IA.')
        paragraph(data['note'])
    elif data:
        for key, label in [('facts','Informações identificadas'), ('gaps','Informações que faltam esclarecer')]:
            heading(label)
            for value in data[key]:
                paragraph('- ' + value)
            if not data[key]:
                paragraph('Nenhum item indicado nesta ficha.')
        answered = {a['question'] for a in answers}
        pending = [q for q in data['questions'] if q not in answered]
        heading('Perguntas ainda não respondidas')
        for question in pending:
            paragraph('- ' + question)
        if not pending:
            paragraph('Não há novas perguntas pendentes nesta ficha.')
        heading('Observação sobre o registro')
        paragraph(data['note'])
    elif summary:
        paragraph('Resumo anterior gerado por IA. Ainda não atualizado para o formato de entrevista.', 'small')
        paragraph(summary)
    else:
        paragraph('A ficha de IA ainda não foi gerada. O relato original e as respostas registradas permanecem disponíveis neste documento.')
    story.append(Spacer(1, 6*mm))
    paragraph('Conteúdo gerado por IA pode conter erros. Este documento não substitui a avaliação médica. Protótipo acadêmico: utilizar somente dados fictícios.', 'small')

    def page_frame(canvas, doc):
        canvas.saveState()
        canvas.setFont('MedPriorBold', 9)
        canvas.setFillColor(colors.HexColor('#3b4a60'))
        canvas.drawString(20*mm, A4[1]-15*mm, 'MEDPRIOR | PRÉ-ATENDIMENTO')
        canvas.setStrokeColor(colors.HexColor('#d3d9e1'))
        canvas.line(20*mm, A4[1]-18*mm, A4[0]-20*mm, A4[1]-18*mm)
        canvas.setFont('MedPrior', 8)
        canvas.drawString(20*mm, 13*mm, 'Para revisão médica - informações fornecidas e registradas pela equipe')
        canvas.drawRightString(A4[0]-20*mm, 13*mm, f'Página {doc.page}')
        canvas.restoreState()
    document.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    output.seek(0)
    return output
