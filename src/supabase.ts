import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://ydllipwqkiebajvioitt.supabase.co";
const supabaseKey = "sb_publishable_UW78UhoBb49LHyvm5uu3Eg_YFdU_mT8";

export const supabase = createClient(supabaseUrl, supabaseKey);