<?php

/**
 * phpList configuration for newsletters.essentialsedm.com.
 *
 * Mounted at /etc/phplist/config.php, which both the image's Apache vhost
 * (`SetEnv ConfigFile`) and its `phplist` CLI wrapper read. Every secret is
 * read from the environment so this file can stay in git.
 */

$database_host = getenv('PHPLIST_DATABASE_HOST') ?: 'db';
$database_port = getenv('PHPLIST_DATABASE_PORT') ?: '3306';
$database_name = getenv('PHPLIST_DATABASE_NAME');
$database_user = getenv('PHPLIST_DATABASE_USER');
$database_password = getenv('PHPLIST_DATABASE_PASSWORD');
$phplist_secret = getenv('PHPLIST_SECRET');

// Never suppress mail: a campaign marked sent must actually have left the box.
define('TEST', 0);
define('HASH_ALGO', 'sha256');

$installation_name = 'ESSENTIALS Newsletter';
$pageroot = '/lists';
$default_system_language = 'en';

// Uploaded images live on a volume; lists/images holds phpList's own artwork.
define('UPLOADIMAGES_DIR', 'uploadimages');

// Relay through the host Postfix on the private Docker bridge. The listener is
// bound to the bridge address, accepts only this network, and does HELO/DKIM
// as mail.essentialsedm.com — so newsletters share the domain's SPF and DKIM.
define('PHPMAILERHOST', getenv('PHPLIST_SMTP_HOST') ?: '172.16.9.1');
define('PHPMAILERPORT', (int) (getenv('PHPLIST_SMTP_PORT') ?: 2525));
define('PHPMAILER_SECURE', false);

// Bounces are collected by Postfix at the envelope address. Turning the admin
// page into the only place the queue can run would need a logged-in browser;
// the image's cron already runs it every minute.
define('MANUALLY_PROCESS_QUEUE', 0);
define('MANUALLY_PROCESS_BOUNCES', 0);

$message_envelope = getenv('PHPLIST_BOUNCE_ADDRESS') ?: 'bounce@essentialsedm.com';

// Bounces land in the dedicated bounce@ mailbox, a normal Dovecot account on
// this host, and are collected over IMAPS by the image's cron and by hand.
$bounce_mailbox_host = getenv('PHPLIST_BOUNCE_IMAP_HOST') ?: 'mail.essentialsedm.com';
$bounce_mailbox_user = getenv('PHPLIST_BOUNCE_IMAP_USER') ?: 'bounce@essentialsedm.com';
$bounce_mailbox_password = getenv('PHPLIST_BOUNCE_IMAP_PASSWORD');
$bounce_mailbox_port = getenv('PHPLIST_BOUNCE_IMAP_PORT') ?: '993/imap/ssl';
$bounce_mailbox_purge = 1;
$bounce_mailbox_purge_unprocessed = 1;

// The add-on and core updaters are not used; keep them off the web root.
$addonsUpdater = [
    'work' => '/var/tmp/phplistupdate',
];
$updaterConfig = [
    'work' => '/var/tmp/phplistupdate',
];
