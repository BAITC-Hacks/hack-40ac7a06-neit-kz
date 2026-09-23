import { systemPrompt as parsePrompt } from '../lib/parse';
import { systemPrompt as explainPrompt } from '../lib/explain';

console.log('==================== 1. РАЗБОР ЗАПРОСА (/api/parse) ====================\n');
console.log(parsePrompt());
console.log('\n==================== 2. ОБЪЯСНЕНИЯ КАРТОЧЕК (/api/match) ====================\n');
console.log(explainPrompt());
