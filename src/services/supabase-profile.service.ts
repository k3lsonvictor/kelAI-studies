import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { TrialUserRepository } from "../repositories/trial-user.repository.js";

export interface SupabaseProfileData {
  id: string;
  contact_number?: string | null;
  phone?: string | null;
  display_phone?: string | null;
  display_contact_number?: string | null;
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
  isTrial?: boolean;
  isFirstWelcome?: boolean;
}

export class SupabaseProfileService {
  private readonly client;
  private readonly trialUserRepository: TrialUserRepository;

  constructor() {
    this.client = createClient(env.supabaseUrl, env.supabaseAnonKey);
    this.trialUserRepository = new TrialUserRepository();
  }

  /**
   * Busca e valida se o número de telefone de entrada possui cadastro na tabela `profiles` do Supabase.
   * Se NÃO for cadastrado no Supabase, ativa/cria o perfil TRIAL com 3 créditos.
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

      if (!error && data && data.length > 0) {
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

        if (matchedProfile) {
          console.log(`[SupabaseProfileService] Perfil AUTORIZADO no Supabase para ${rawPhone}! ID: ${matchedProfile.id} | Instagram: "${matchedProfile.instagram_profile || 'N/A'}" | Créditos: ${matchedProfile.credits ?? 0}`);

          return {
            isAuthorized: true,
            profile: {
              id: matchedProfile.id,
              contactNumber: matchedProfile.display_phone || matchedProfile.display_contact_number || matchedProfile.contact_number || matchedProfile.phone || rawPhone,
              instagramProfile: matchedProfile.instagram_profile || "",
              logoUrl: matchedProfile.logo_url || "",
              primaryColor: matchedProfile.primary_color || undefined,
              secondaryColor: matchedProfile.secondary_color || undefined,
              credits: matchedProfile.credits ?? 0,
              isTrial: false,
            },
          };
        }
      }

      // Se não for encontrado na tabela 'profiles' do Supabase, ativa a lógica de Usuário Trial (3 Créditos)
      console.log(`[SupabaseProfileService] Número ${rawPhone} não cadastrado no Supabase. Ativando Perfil TRIAL...`);

      let trialUser = await this.trialUserRepository.findByPhone(rawPhone);
      let isFirstWelcome = false;

      if (!trialUser) {
        trialUser = await this.trialUserRepository.create(rawPhone, 3);
        isFirstWelcome = true;
        console.log(`[SupabaseProfileService] Criado novo usuário Trial para ${rawPhone} com 3 créditos! ID: ${trialUser.id}`);
      } else {
        isFirstWelcome = !trialUser.isWelcomed;
      }

      return {
        isAuthorized: true,
        profile: {
          id: trialUser.id,
          contactNumber: rawPhone,
          instagramProfile: "",
          logoUrl: "",
          credits: trialUser.credits,
          isTrial: true,
          isFirstWelcome,
        },
      };
    } catch (err: any) {
      console.error(`[SupabaseProfileService] Falha na consulta de perfil Supabase:`, err.message || err);

      // Fallback em caso de erro no Supabase: Ativa Trial
      try {
        let trialUser = await this.trialUserRepository.findByPhone(rawPhone);
        if (!trialUser) {
          trialUser = await this.trialUserRepository.create(rawPhone, 3);
          return {
            isAuthorized: true,
            profile: {
              id: trialUser.id,
              contactNumber: rawPhone,
              instagramProfile: "",
              logoUrl: "",
              credits: 3,
              isTrial: true,
              isFirstWelcome: true,
            },
          };
        }
        return {
          isAuthorized: true,
          profile: {
            id: trialUser.id,
            contactNumber: rawPhone,
            instagramProfile: "",
            logoUrl: "",
            credits: trialUser.credits,
            isTrial: true,
            isFirstWelcome: !trialUser.isWelcomed,
          },
        };
      } catch (fallbackErr) {
        return { isAuthorized: false, profile: null };
      }
    }
  }

  /**
   * Marca que o usuário Trial já recebeu a mensagem de apresentação/boas-vindas.
   */
  async markTrialAsWelcomed(trialUserId: string): Promise<void> {
    await this.trialUserRepository.markAsWelcomed(trialUserId);
  }

  /**
   * Deduz 1 crédito do perfil. Se for perfil Trial, deduz da tabela local trial_users. Se for assinante Supabase, atualiza no Supabase.
   */
  async deductCredit(profileId: string, currentCredits: number, isTrial?: boolean): Promise<number> {
    if (isTrial) {
      console.log(`[SupabaseProfileService] Deduzindo 1 crédito do usuário TRIAL ID ${profileId}. Saldo anterior: ${currentCredits}`);
      return this.trialUserRepository.deductCredit(profileId, currentCredits);
    }

    const finalCredits = Math.max(0, currentCredits - 1);
    try {
      console.log(`[SupabaseProfileService] Deduzindo 1 crédito do perfil Supabase ID ${profileId}. Saldo anterior: ${currentCredits} | Novo saldo: ${finalCredits}`);

      const { error } = await this.client
        .from("profiles")
        .update({ credits: finalCredits })
        .eq("id", profileId);

      if (error) {
        throw error;
      }

      return finalCredits;
    } catch (err: any) {
      console.error(`[SupabaseProfileService] Falha ao deduzir crédito para ID ${profileId}:`, err.message || err);
      return currentCredits;
    }
  }
}
