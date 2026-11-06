from __future__ import annotations

import asyncio
import logging

import aiosmtplib

from session_mail.mail.errors import MailError

log = logging.getLogger("session.smtp")


async def _send(message, account, secret: dict, access_token: str | None) -> None:
    use_tls = account.smtp_mode == "ssl"
    start_tls = account.smtp_mode == "starttls"
    smtp = aiosmtplib.SMTP(
        hostname=account.smtp_host,
        port=account.smtp_port,
        use_tls=use_tls,
        start_tls=start_tls,
        timeout=40,
    )
    await smtp.connect()
    username = account.username or account.email
    try:
        if access_token:
            response = await smtp.auth_xoauth2(username, access_token)
            if response and response.code >= 400:
                raise MailError(f"SMTP refused the sign-in for {account.email}.")
        else:
            password = secret.get("password") or ""
            if not password:
                raise MailError("This account has no password saved.")
            await smtp.login(username, password)
        await smtp.send_message(message)
    finally:
        try:
            await smtp.quit()
        except Exception:
            log.debug("SMTP quit failed", exc_info=True)


def send_message(message, account, secret: dict, access_token: str | None = None) -> None:
    try:
        asyncio.run(_send(message, account, secret, access_token))
    except MailError:
        raise
    except Exception as exc:
        raise MailError(f"Couldn't send from {account.email}: {exc}") from exc
