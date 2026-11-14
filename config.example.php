<?php
/**
 * Treva Server-Side Secrets & Configuration (Template)
 * Copy this file to config.php and add your server-side API keys locally,
 * or set OPENAI_API_KEY in your environment. Never commit config.php.
 */

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'config.php') {
    http_response_code(403);
    exit('Forbidden');
}

if (!defined('OPENAI_API_KEY')) {
    $envKey = getenv('OPENAI_API_KEY');
    define('OPENAI_API_KEY', is_string($envKey) ? trim($envKey) : '');
}
