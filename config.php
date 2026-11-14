<?php
/**
 * Treva Server-Side Secrets & Configuration
 * Keep all secret API keys here or in protected data/smart_config.json only.
 * Never echo OPENAI_API_KEY into client HTML, JS, or API JSON responses.
 */

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'config.php') {
    http_response_code(403);
    exit('Forbidden');
}

if (!defined('OPENAI_API_KEY')) {
    $envKey = getenv('OPENAI_API_KEY');
    define('OPENAI_API_KEY', is_string($envKey) ? trim($envKey) : '');
}
