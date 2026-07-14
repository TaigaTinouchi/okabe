import type { Interval } from "./freebusy";

/**
 * Google Calendar への薄い REST クライアント。
 * googleapis SDK は使わない（依存最小の方針。必要なのは token refresh + 2 エンドポイントだけ）。
 * refresh token は初回認可（scripts/google-auth.ts、手順は README）で取得して環境変数に置く。
 */

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId?: string;
  /** テスト差し替え用 */
  fetchFn?: typeof fetch;
}

export interface CalendarEvent {
  summary: string;
  /** ISO 8601（終日予定は YYYY-MM-DD） */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarClient {
  private readonly calendarId: string;
  private readonly fetchFn: typeof fetch;
  private accessToken?: { token: string; expiresAt: number };

  constructor(private readonly config: GoogleCalendarConfig) {
    this.calendarId = config.calendarId ?? "primary";
    this.fetchFn = config.fetchFn ?? fetch;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt - 60_000) {
      return this.accessToken.token;
    }
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = {
      token: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }

  private async api(path: string, init?: RequestInit): Promise<unknown> {
    const token = await this.getAccessToken();
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        authorization: `Bearer ${token}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Google Calendar API error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  /** freebusy: busy 区間（epoch ms）を返す */
  async freeBusy(timeMinIso: string, timeMaxIso: string): Promise<Interval[]> {
    const body = (await this.api("/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        timeZone: "Asia/Tokyo",
        items: [{ id: this.calendarId }],
      }),
    })) as { calendars: Record<string, { busy: Array<{ start: string; end: string }> }> };

    const busy = body.calendars[this.calendarId]?.busy ?? [];
    return busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
  }

  /** events.list: 期間内の予定（繰り返しは展開済み・開始時刻順） */
  async listEvents(timeMinIso: string, timeMaxIso: string): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      maxResults: "50",
      timeZone: "Asia/Tokyo",
    });
    const body = (await this.api(
      `/calendars/${encodeURIComponent(this.calendarId)}/events?${params}`,
    )) as {
      items?: Array<{
        summary?: string;
        location?: string;
        start: { dateTime?: string; date?: string };
        end: { dateTime?: string; date?: string };
      }>;
    };

    return (body.items ?? []).map((item) => {
      const allDay = item.start.date != null;
      return {
        summary: item.summary ?? "（無題）",
        start: item.start.dateTime ?? item.start.date ?? "",
        end: item.end.dateTime ?? item.end.date ?? "",
        allDay,
        ...(item.location ? { location: item.location } : {}),
      };
    });
  }
}
