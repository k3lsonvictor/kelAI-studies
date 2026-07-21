import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

export interface SupabaseProfileData {
  id: string;
  contact_number?: string | null;
  phone?: string | null;
  instagram_profile?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  is_approved?: boolean | null;
  credits?: number | null;
}

export interface UserProfileInfo {
  id?: string;
  contactNumber: string;
  instagramProfile: string;
  logoUrl: string;
  primaryColor?: string;
  secondaryColor?: string;
  credits?: number;
}

export class SupabaseProfileService {
  private readonly client;

  constructor() {
    this.client = createClient(env.supabaseUrl, env.supabaseAnonKey);
  }

  /**
   * Busca e valida se o número de telefone de entrada possui cadastro na tabela `profiles` do Supabase.
   * Retorna os dados do perfil (número de telefone comercial, @ do Instagram, logo, cores e créditos).
   */
  async getProfileByPhone(rawPhone: string): Promise<{
    isAuthorized: boolean;
    profile: UserProfileInfo | null;
  }> {
    const cleanDigits = rawPhone.replace(/\D/g, "");

    try {
      console.log(`[SupabaseProfileService] Consultando autorização do número ${rawPhone} no Supabase...`);

      const { data, error } = await this.client
        .from("profiles")
        .select("*");

      if (error) {
        console.error(`[SupabaseProfileService] Erro ao buscar perfis no Supabase:`, error.message);
        return { isAuthorized: false, profile: null };
      }

      if (!data || data.length === 0) {
        console.warn(`[SupabaseProfileService] Tabela 'profiles' vazia ou sem permissão de leitura.`);
        return { isAuthorized: false, profile: null };
      }

      // Encontra o perfil correspondente comparando os dígitos do telefone de forma robusta
      const matchedProfile = data.find((p: SupabaseProfileData) => {
        const pContact = (p.contact_number || p.phone || "").replace(/\D/g, "");
        if (!pContact || pContact.length < 8) return false;

        const cleanP = pContact.replace(/^55/, "");
        const cleanIncoming = cleanDigits.replace(/^55/, "");

        if (cleanP === cleanIncoming) return true;

        const last8P = cleanP.slice(-8);
        const last8Incoming = cleanIncoming.slice(-8);

        if (last8P !== last8Incoming) return false;

        if (cleanP.length >= 10 && cleanIncoming.length >= 10) {
          const dddP = cleanP.slice(0, 2);
          const dddIncoming = cleanIncoming.slice(0, 2);
          return dddP === dddIncoming;
        }

        return true;
      });

      if (!matchedProfile) {
        console.warn(`[SupabaseProfileService] Número ${rawPhone} NÃO encontrado em 'profiles' do Supabase.`);
        return { isAuthorized: false, profile: null };
      }

      console.log(`[SupabaseProfileService] Perfil AUTORIZADO para ${rawPhone}! ID: ${matchedProfile.id} | Instagram: "${matchedProfile.instagram_profile || 'N/A'}" | Créditos: ${matchedProfile.credits ?? 0}`);

      return {
        isAuthorized: true,
        profile: {
          id: matchedProfile.id,
          contactNumber: matchedProfile.contact_number || matchedProfile.phone || rawPhone,
          instagramProfile: matchedProfile.instagram_profile || "",
          logoUrl: matchedProfile.logo_url || "",
          primaryColor: matchedProfile.primary_color || undefined,
          secondaryColor: matchedProfile.secondary_color || undefined,
          credits: matchedProfile.credits ?? 0,
        },
      };
    } catch (err: any) {
      console.error(`[SupabaseProfileService] Falha na consulta de perfil:`, err.message || err);
      return { isAuthorized: false, profile: null };
    }
  }
}
