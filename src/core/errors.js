'use strict';

/** Error types used across the AI administration pipeline. */

class AppError extends Error {
  constructor(message, code = 'APP_ERROR', details = undefined) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** The AI provider could not be reached, or returned an unusable response. */
class AiProviderError extends AppError {
  constructor(message, details) {
    super(message, 'AI_PROVIDER_ERROR', details);
  }
}

/** The provider is reachable but has no usable quota right now. */
class AiQuotaError extends AiProviderError {
  constructor(message, details) {
    super(message, details);
    this.code = 'AI_QUOTA_EXCEEDED';
  }
}

/** The requester is not allowed to use AI administration. */
class AuthorizationError extends AppError {
  constructor(message = 'You are not authorised to use this command.') {
    super(message, 'NOT_AUTHORIZED');
  }
}

/** A proposed action is not allowed (allowlist, schema, or policy). */
class ActionRejectedError extends AppError {
  constructor(message, details) {
    super(message, 'ACTION_REJECTED', details);
  }
}

/** The bot lacks a Discord permission, or a hierarchy rule blocked the action. */
class DiscordPermissionError extends AppError {
  constructor(message, details) {
    super(message, 'DISCORD_PERMISSION', details);
  }
}

/** The action is valid but would not have the intended effect. */
class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

/** A resource that must exist was not found. */
class NotFoundError extends AppError {
  constructor(message, details) {
    super(message, 'NOT_FOUND', details);
  }
}

/** Normalise an unknown thrown value into an Error. */
function toError(value) {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

module.exports = {
  AppError,
  AiProviderError,
  AiQuotaError,
  AuthorizationError,
  ActionRejectedError,
  DiscordPermissionError,
  ValidationError,
  NotFoundError,
  toError,
};
