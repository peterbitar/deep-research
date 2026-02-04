// Database functions for chat sessions and messages
import { pool } from './client';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  sessionId: string;
  messages: ChatMessage[];
  createdAt: number;
  lastAccessed: number;
  metadata?: {
    // Cached news brief context
    newsBriefContext?: {
      runId: string;
      loadedAt: number;
      tickers: string[];
    };
    // Fresh news cache (per ticker, 1-hour TTL)
    freshNewsCache?: Map<string, {
      learnings: string[];
      urls: string[];
      fetchedAt: number;
    }>;
  };
}

/**
 * Save chat session and messages to database
 */
export async function saveChatSession(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  if (!pool) {
    // Fallback to in-memory if no database
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert session
    await client.query(
      `INSERT INTO chat_sessions (session_id, last_accessed)
       VALUES ($1, CURRENT_TIMESTAMP)
       ON CONFLICT (session_id) DO UPDATE SET
         last_accessed = CURRENT_TIMESTAMP`,
      [sessionId]
    );

    // Delete old messages
    await client.query('DELETE FROM chat_messages WHERE session_id = $1', [sessionId]);

    // Insert new messages
    for (let i = 0; i < messages.length; i++) {
      await client.query(
        `INSERT INTO chat_messages (session_id, role, content, message_order)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, messages[i].role, messages[i].content, i]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving chat session:', error);
    // Don't throw - fallback gracefully
  } finally {
    client.release();
  }
}

/**
 * Get chat session from database
 */
export async function getChatSession(sessionId: string): Promise<ChatSession | null> {
  if (!pool) return null;

  try {
    // Get session
    const sessionResult = await pool.query(
      `SELECT session_id, created_at, last_accessed
       FROM chat_sessions
       WHERE session_id = $1`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) return null;

    // Get messages
    const messagesResult = await pool.query(
      `SELECT role, content, created_at
       FROM chat_messages
       WHERE session_id = $1
       ORDER BY message_order`,
      [sessionId]
    );

    const session = sessionResult.rows[0];
    return {
      sessionId: session.session_id,
      messages: messagesResult.rows.map(row => ({
        role: row.role,
        content: row.content,
        timestamp: new Date(row.created_at).getTime(),
      })),
      createdAt: new Date(session.created_at).getTime(),
      lastAccessed: new Date(session.last_accessed).getTime(),
    };
  } catch (error) {
    console.error('Error getting chat session:', error);
    return null;
  }
}

/**
 * Clean up old chat sessions (older than 24 hours)
 */
export async function cleanupOldChatSessions(): Promise<void> {
  if (!pool) return;

  try {
    await pool.query(
      `DELETE FROM chat_sessions
       WHERE last_accessed < NOW() - INTERVAL '24 hours'`
    );
  } catch (error) {
    console.error('Error cleaning up chat sessions:', error);
  }
}
