from email.message import EmailMessage

from session_mail.mail.parse import parse_message, sanitize_html


def test_parse_multipart_strips_script_and_keeps_attachment():
    message = EmailMessage()
    message["From"] = "Mara Chen <mara@harbor.example>"
    message["To"] = "Ada <ada@northwind.example>"
    message["Subject"] = "Dock ledger"
    message["Message-ID"] = "<dock@harbor.example>"
    message["Date"] = "Fri, 06 Nov 2026 09:00:00 +0000"
    message.set_content("The dockledger is ready.")
    message.add_alternative("<p>Hello</p><script>alert(1)</script>", subtype="html")
    message.add_attachment(b"\x89PNG", maintype="image", subtype="png", filename="slip.png")
    parsed = parse_message(message.as_bytes(), full=True)
    assert parsed.subject == "Dock ledger"
    assert parsed.from_email == "mara@harbor.example"
    assert "dockledger" in parsed.text
    assert "<script" not in parsed.html.lower()
    assert "Hello" in parsed.html
    assert parsed.attachments[0].filename == "slip.png"
    assert "<script" not in sanitize_html("<script>nope</script><p>Kept</p>").lower()
