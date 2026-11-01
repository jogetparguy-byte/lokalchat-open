export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chats: {
        Row: {
          business_id: string
          created_at: string
          customer_name: string | null
          customer_phone: string
          id: string
          is_bot_active: boolean
          last_message: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          customer_name?: string | null
          customer_phone: string
          id?: string
          is_bot_active?: boolean
          last_message?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string
          id?: string
          is_bot_active?: boolean
          last_message?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      handoff_events: {
        Row: {
          ai_reason: string | null
          ai_suggested_action: string | null
          business_id: string
          chat_id: string
          created_at: string
          id: string
          insight_generated_at: string | null
        }
        Insert: {
          ai_reason?: string | null
          ai_suggested_action?: string | null
          business_id: string
          chat_id: string
          created_at?: string
          id?: string
          insight_generated_at?: string | null
        }
        Update: {
          ai_reason?: string | null
          ai_suggested_action?: string | null
          business_id?: string
          chat_id?: string
          created_at?: string
          id?: string
          insight_generated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handoff_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoff_events_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      kb_documents: {
        Row: {
          business_id: string
          created_at: string
          file_name: string
          file_size: number
          file_type: string
          id: string
          status: string
          status_message: string | null
          storage_path: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          file_name: string
          file_size?: number
          file_type: string
          id?: string
          status?: string
          status_message?: string | null
          storage_path: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          status?: string
          status_message?: string | null
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_documents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          business_id: string | null
          content: string
          created_at: string
          document_id: string | null
          embedding: string | null
          id: number
        }
        Insert: {
          business_id?: string | null
          content: string
          created_at?: string
          document_id?: string | null
          embedding?: string | null
          id?: number
        }
        Update: {
          business_id?: string | null
          content?: string
          created_at?: string
          document_id?: string | null
          embedding?: string | null
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_base_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "kb_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          client_request_id: string | null
          chat_id: string
          created_at: string
          delivery_attempts: number
          delivery_started_at: string | null
          delivery_status: string | null
          external_message_id: string | null
          id: string
          last_delivery_error: string | null
          processed_at: string | null
          processing_started_at: string | null
          processing_status: string
          reply_to_external_message_id: string | null
          sender: Database["public"]["Enums"]["message_sender"]
          sent_at: string | null
          text: string
        }
        Insert: {
          client_request_id?: string | null
          chat_id: string
          created_at?: string
          delivery_attempts?: number
          delivery_started_at?: string | null
          delivery_status?: string | null
          external_message_id?: string | null
          id?: string
          last_delivery_error?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          processing_status?: string
          reply_to_external_message_id?: string | null
          sender: Database["public"]["Enums"]["message_sender"]
          sent_at?: string | null
          text: string
        }
        Update: {
          client_request_id?: string | null
          chat_id?: string
          created_at?: string
          delivery_attempts?: number
          delivery_started_at?: string | null
          delivery_status?: string | null
          external_message_id?: string | null
          id?: string
          last_delivery_error?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          processing_status?: string
          reply_to_external_message_id?: string | null
          sender?: Database["public"]["Enums"]["message_sender"]
          sent_at?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_api_keys: {
        Row: {
          api_key_encrypted: string
          created_at: string
          id: string
          is_active: boolean
          provider: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted: string
          created_at?: string
          id?: string
          is_active?: boolean
          provider: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string
          created_at?: string
          id?: string
          is_active?: boolean
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          business_name: string
          checklist_celebrated_at: string | null
          checklist_dismissed_session: string | null
          created_at: string
          id: string
          inventory_api_url: string | null
          owner_whatsapp: string | null
          role: string
          simulator_tested_at: string | null
          system_prompt: string | null
          updated_at: string
          weekly_report_sent_at: string | null
        }
        Insert: {
          business_name?: string
          checklist_celebrated_at?: string | null
          checklist_dismissed_session?: string | null
          created_at?: string
          id: string
          inventory_api_url?: string | null
          owner_whatsapp?: string | null
          role?: string
          simulator_tested_at?: string | null
          system_prompt?: string | null
          updated_at?: string
          weekly_report_sent_at?: string | null
        }
        Update: {
          business_name?: string
          checklist_celebrated_at?: string | null
          checklist_dismissed_session?: string | null
          created_at?: string
          id?: string
          inventory_api_url?: string | null
          owner_whatsapp?: string | null
          role?: string
          simulator_tested_at?: string | null
          system_prompt?: string | null
          updated_at?: string
          weekly_report_sent_at?: string | null
        }
        Relationships: []
      }
      unanswered_question_occurrences: {
        Row: {
          business_id: string
          chat_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          failed_after_faq: boolean
          id: string
          question_id: string
          question_text: string
        }
        Insert: {
          business_id: string
          chat_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          failed_after_faq?: boolean
          id?: string
          question_id: string
          question_text: string
        }
        Update: {
          business_id?: string
          chat_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          failed_after_faq?: boolean
          id?: string
          question_id?: string
          question_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "unanswered_question_occurrences_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unanswered_question_occurrences_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unanswered_question_occurrences_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "unanswered_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      unanswered_questions: {
        Row: {
          business_id: string
          created_at: string
          embedding: string | null
          failed_after_faq_count: number
          faq_id: number | null
          first_asked_at: string
          id: string
          last_asked_at: string
          last_failed_after_faq_at: string | null
          normalized_tokens: string[]
          occurrence_count: number
          question: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          embedding?: string | null
          failed_after_faq_count?: number
          faq_id?: number | null
          first_asked_at?: string
          id?: string
          last_asked_at?: string
          last_failed_after_faq_at?: string | null
          normalized_tokens?: string[]
          occurrence_count?: number
          question: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          embedding?: string | null
          failed_after_faq_count?: number
          faq_id?: number | null
          first_asked_at?: string
          id?: string
          last_asked_at?: string
          last_failed_after_faq_at?: string | null
          normalized_tokens?: string[]
          occurrence_count?: number
          question?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unanswered_questions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unanswered_questions_faq_id_fkey"
            columns: ["faq_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_connections: {
        Row: {
          access_token: string | null
          access_token_encrypted: string | null
          app_secret_encrypted: string | null
          business_id: string
          connection_status: string
          created_at: string
          display_phone_number: string | null
          id: string
          last_error_message: string | null
          last_verified_at: string | null
          phone_number_id: string
          updated_at: string
          verify_token: string
          waba_id: string | null
        }
        Insert: {
          access_token?: string | null
          access_token_encrypted?: string | null
          app_secret_encrypted?: string | null
          business_id: string
          connection_status?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          last_error_message?: string | null
          last_verified_at?: string | null
          phone_number_id: string
          updated_at?: string
          verify_token: string
          waba_id?: string | null
        }
        Update: {
          access_token?: string | null
          access_token_encrypted?: string | null
          app_secret_encrypted?: string | null
          business_id?: string
          connection_status?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          last_error_message?: string | null
          last_verified_at?: string | null
          phone_number_id?: string
          updated_at?: string
          verify_token?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_inbound_message: {
        Args: {
          p_chat_id: string
          p_external_message_id: string
          p_stale_seconds?: number
        }
        Returns: boolean
      }
      claim_outbound_message: {
        Args: {
          p_message_id: string
          p_stale_seconds?: number
        }
        Returns: boolean
      }
      finish_inbound_message: {
        Args: {
          p_chat_id: string
          p_external_message_id: string
          p_status: string
        }
        Returns: undefined
      }
      finish_outbound_message: {
        Args: {
          p_message_id: string
          p_status: string
          p_error?: string | null
        }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      match_documents: {
        Args: {
          business_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: number
          similarity: number
        }[]
      }
    }
    Enums: {
      message_sender: "customer" | "bot" | "human" | "system"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      message_sender: ["customer", "bot", "human", "system"],
    },
  },
} as const

