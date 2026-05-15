<?php

return [
    'default' => 'default',
    'accounts' => [
        'default' => [
            'host'  => env('IMAP_HOST', 'localhost'),
            'port'  => env('IMAP_PORT', 993),
            'protocol'  => env('IMAP_PROTOCOL', 'imap'),
            'encryption'    => env('IMAP_ENCRYPTION', 'ssl'),
            'validate_cert' => env('IMAP_VALIDATE_CERT', true),
            'username' => env('IMAP_USERNAME', 'Support@technosprint.net'),
            'password' => env('IMAP_PASSWORD', ''),
            'authentication' => env('IMAP_AUTHENTICATION', null),
            'proxy' => [
                'socket' => null,
                'request_fulluri' => false,
                'username' => null,
                'password' => null,
            ]
        ],
    ],
    'options' => [
        'delimiter' => '/',
        'fetch' => \Webklex\PHPIMAP\IMAP::FT_PEEK,
        'fetch_order' => 'asc',
        'open' => [
            // 'DISABLE_AUTHENTICATOR' => 'GSSAPI'
        ]
    ],
    'flags' => ['recent', 'flagged', 'answered', 'deleted', 'seen', 'draft'],
];
