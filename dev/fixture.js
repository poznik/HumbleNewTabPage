// Нейтральное дерево закладок для стенда: та же форма, что у типовой
// страницы владельца (4 колонки, вложенные и свёрнутые папки, длинные
// названия), без реальных рабочих ссылок — репозиторий публичный.
window.HNTP_FIXTURE = {
	version: 1,
	tree: [
		{ title: 'Панель закладок', children: [
			{ title: 'Main', children: [
				{ title: 'Хабр', url: 'https://habr.com/' },
				{ title: 'Википедия', url: 'https://ru.wikipedia.org/' },
				{ title: 'GitHub', url: 'https://github.com/' },
				{ title: 'Погода', url: 'https://weather.example.com/' },
				{ title: 'Новости', url: 'https://news.example.com/' }
			] },
			{ title: 'Later', children: [
				{ title: 'Статья на выходные', url: 'https://read.example.com/1' },
				{ title: 'Доклад с конференции', url: 'https://video.example.com/2' }
			] },
			{ title: 'Work', children: [
				{ title: 'Services', children: [
					{ title: 'Подтверждения — служба поддержки', url: 'https://support.example.com/approvals' },
					{ title: 'Сервер отчётов Power BI — продажи и выручка', url: 'https://bi.example.com/sales' },
					{ title: 'Настройки доступа к модели (платформа)', url: 'https://wiki.example.com/access' },
					{ title: 'Metrics – FigJam', url: 'https://figma.com/board/metrics' },
					{ title: 'Таблица планирования', url: 'https://sheets.example.com/plan' },
					{ title: 'BI Reports', url: 'https://bi.example.com/reports' },
					{ title: 'Wiki — черновики', url: 'https://wiki.example.com/drafts' },
					{ title: 'Wiki — личное', url: 'https://wiki.example.com/me' },
					{ title: 'Трекер задач', url: 'https://tracker.example.com/' },
					{ title: 'Структура компании', url: 'https://portal.example.com/org' },
					{ title: 'Личный кабинет', url: 'https://portal.example.com/me' },
					{ title: 'Brand resources — Marketing guidelines', url: 'https://wiki.example.com/brand' }
				] },
				{ title: 'Статусы', children: [
					{ title: 'Статус направления — еженедельная сводка', url: 'https://wiki.example.com/status' },
					{ title: 'Weekly reports — team space', url: 'https://wiki.example.com/weekly' },
					{ title: '[PUBLIC] Weekly Meetings 2026', url: 'https://wiki.example.com/meetings' }
				] },
				{ title: 'Archive', children: [
					{ title: 'Старый проект', url: 'https://wiki.example.com/old' }
				] },
				{ title: 'Watch', children: [
					{ title: 'AI_Assistant_Success_Story', url: 'https://wiki.example.com/story' },
					{ title: 'Problems Critical/Major — фильтр', url: 'https://tracker.example.com/filter' }
				] }
			] },
			{ title: 'AI', children: [
				{ title: 'Deepseek', children: [
					{ title: 'DeepSeek', url: 'https://chat.deepseek.com/' },
					{ title: 'DeepSeek Platform', url: 'https://platform.deepseek.com/' },
					{ title: 'DeepSeek Api Keys', url: 'https://platform.deepseek.com/api_keys' },
					{ title: 'Team DeepSeek Api keys', url: 'https://sheets.example.com/keys' }
				] },
				{ title: 'ChatGPT', url: 'https://chatgpt.com/' },
				{ title: 'Codex Usage', url: 'https://chatgpt.com/codex' },
				{ title: 'Claude', url: 'https://claude.ai/' },
				{ title: 'Claude Usage', url: 'https://claude.ai/settings/usage' },
				{ title: 'Полезное', children: [
					{ title: 'Промпты', url: 'https://notes.example.com/prompts' }
				] }
			] },
			{ title: 'Home', children: [
				{ title: 'Умный дом', url: 'https://home.example.com/' },
				{ title: 'Счета', url: 'https://bills.example.com/' }
			] }
		] },
		{ title: 'Другие закладки', children: [] }
	],
	// колонки — по названиям папок, как их разложил владелец
	columns: [['Main', 'Later'], ['Work'], ['AI'], ['Home']],
	open: ['Main', 'Work', 'Services', 'Статусы', 'Watch', 'AI', 'Deepseek'],
	options: { show_root: 1, show_top: 0, show_apps: 0, show_recent: 0, show_closed: 0, show_devices: 0 }
};
