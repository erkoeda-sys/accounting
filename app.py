import os
import json
import pdfplumber
import anthropic
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

PDFS_DIR = os.path.join(os.path.dirname(__file__), "pdfs")
pdf_texts: dict[str, str] = {}

SYSTEM_PROMPT_TEMPLATE = """あなたは会計基準の専門家AIアシスタントです。
提供された会計基準のPDF資料をもとに、ユーザーの質問に対して適切な会計処理について回答してください。

回答の際は以下の点を心がけてください：
- 根拠となる会計基準の条文や内容を明示する
- 実務的な観点からも解説する
- 不明確な点や資料に記載がない点は正直に伝える
- 専門用語は適切に使用し、必要に応じて説明を加える

【参照している会計基準資料】
{pdf_list}

【各資料の内容】
{pdf_context}
"""


def load_pdfs() -> None:
    global pdf_texts
    pdf_texts = {}
    if not os.path.exists(PDFS_DIR):
        return
    for filename in sorted(os.listdir(PDFS_DIR)):
        if not filename.lower().endswith(".pdf"):
            continue
        filepath = os.path.join(PDFS_DIR, filename)
        try:
            with pdfplumber.open(filepath) as pdf:
                pages_text = [page.extract_text() or "" for page in pdf.pages]
            pdf_texts[filename] = "\n".join(pages_text)
            print(f"[PDF] Loaded: {filename} ({len(pdf_texts[filename])} chars)")
        except Exception as e:
            print(f"[PDF] Error loading {filename}: {e}")


def build_system_prompt() -> str:
    if not pdf_texts:
        return (
            "あなたは会計基準の専門家AIアシスタントです。"
            "現在PDFファイルが読み込まれていません。"
            "サーバーの pdfs/ ディレクトリにPDFを配置してリロードしてください。"
        )
    pdf_list = "\n".join(f"- {name}" for name in pdf_texts)
    pdf_context = ""
    for name, text in pdf_texts.items():
        pdf_context += f"\n{'='*60}\n【{name}】\n{'='*60}\n{text}\n"
    return SYSTEM_PROMPT_TEMPLATE.format(pdf_list=pdf_list, pdf_context=pdf_context)


# Load PDFs when the app starts
load_pdfs()


@app.route("/")
def index():
    loaded = [{"name": name, "chars": len(text)} for name, text in pdf_texts.items()]
    return render_template("index.html", loaded_pdfs=loaded)


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    if not messages:
        return jsonify({"error": "メッセージがありません"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY が設定されていません"}), 500

    client = anthropic.Anthropic(api_key=api_key)
    system_prompt = build_system_prompt()

    def generate():
        try:
            with client.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=2048,
                system=system_prompt,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text}, ensure_ascii=False)}\n\n"
        except anthropic.APIError as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/pdfs", methods=["GET"])
def list_pdfs():
    return jsonify(
        [{"name": name, "chars": len(text)} for name, text in pdf_texts.items()]
    )


@app.route("/api/reload", methods=["POST"])
def reload_pdfs():
    load_pdfs()
    return jsonify(
        [{"name": name, "chars": len(text)} for name, text in pdf_texts.items()]
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
