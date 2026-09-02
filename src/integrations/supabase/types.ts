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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      order_action_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          order_id: string
          token: string
          used: boolean
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          order_id: string
          token: string
          used?: boolean
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          order_id?: string
          token?: string
          used?: boolean
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_action_tokens_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          customer_id: string | null
          delivery_address: string | null
          delivery_fee: number
          delivery_method: string
          delivery_zone: string | null
          email: string
          first_name: string
          id: string
          invoice_number: string | null
          invoice_path: string | null
          lang: string
          last_name: string
          newsletter_subscription: boolean | null
          order_comment: string | null
          order_number: string | null
          order_source: string
          order_validation: string
          paid_at: string | null
          payment_method: string | null
          payment_status: string
          phone: string
          pickup_delivery_date: string | null
          pickup_delivery_datetime: string
          pickup_delivery_slot: string | null
          postfinance_transaction_id: string | null
          reward_amount_earned: number | null
          reward_amount_used: number | null
          total_amount: number
          welcome_discount_amount: number | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          delivery_method: string
          delivery_zone?: string | null
          email: string
          first_name: string
          id?: string
          invoice_number?: string | null
          invoice_path?: string | null
          lang: string
          last_name: string
          newsletter_subscription?: boolean | null
          order_comment?: string | null
          order_number?: string | null
          order_source?: string
          order_validation?: string
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: string
          phone: string
          pickup_delivery_date?: string | null
          pickup_delivery_datetime: string
          pickup_delivery_slot?: string | null
          postfinance_transaction_id?: string | null
          reward_amount_earned?: number | null
          reward_amount_used?: number | null
          total_amount: number
          welcome_discount_amount?: number | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          delivery_method?: string
          delivery_zone?: string | null
          email?: string
          first_name?: string
          id?: string
          invoice_number?: string | null
          invoice_path?: string | null
          lang?: string
          last_name?: string
          newsletter_subscription?: boolean | null
          order_comment?: string | null
          order_number?: string | null
          order_source?: string
          order_validation?: string
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: string
          phone?: string
          pickup_delivery_date?: string | null
          pickup_delivery_datetime?: string
          pickup_delivery_slot?: string | null
          postfinance_transaction_id?: string | null
          reward_amount_earned?: number | null
          reward_amount_used?: number | null
          total_amount?: number
          welcome_discount_amount?: number | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          assigned_to: string | null
          base_color: string | null
          butterfly_color: string | null
          cake_text: string | null
          candle_colors: string[] | null
          candle_name: string | null
          candle_quantity: number | null
          candles: Json
          candles_price: number
          created_at: string
          decoration_color: string | null
          design: string | null
          design_image_url: string | null
          extra: string | null
          extra_color: string | null
          extra_type: string | null
          extras: string[]
          extras_price: number
          flavors: string[]
          id: string
          internal_notes: string | null
          item_comment: string | null
          made_by: string | null
          order_id: string
          product: string
          production_status: string | null
          reference_images: string[]
          ribbon_color: string | null
          shape: string | null
          size: string | null
          text_color: string | null
          text_style: string | null
          total: number
        }
        Insert: {
          assigned_to?: string | null
          base_color?: string | null
          butterfly_color?: string | null
          cake_text?: string | null
          candle_colors?: string[] | null
          candle_name?: string | null
          candle_quantity?: number | null
          candles?: Json
          candles_price?: number
          created_at?: string
          decoration_color?: string | null
          design?: string | null
          design_image_url?: string | null
          extra?: string | null
          extra_color?: string | null
          extra_type?: string | null
          extras?: string[]
          extras_price?: number
          flavors?: string[]
          id?: string
          internal_notes?: string | null
          item_comment?: string | null
          made_by?: string | null
          order_id: string
          product: string
          production_status?: string | null
          reference_images?: string[]
          ribbon_color?: string | null
          shape?: string | null
          size?: string | null
          text_color?: string | null
          text_style?: string | null
          total: number
        }
        Update: {
          assigned_to?: string | null
          base_color?: string | null
          butterfly_color?: string | null
          cake_text?: string | null
          candle_colors?: string[] | null
          candle_name?: string | null
          candle_quantity?: number | null
          candles?: Json
          candles_price?: number
          created_at?: string
          decoration_color?: string | null
          design?: string | null
          design_image_url?: string | null
          extra?: string | null
          extra_color?: string | null
          extra_type?: string | null
          extras?: string[]
          extras_price?: number
          flavors?: string[]
          id?: string
          internal_notes?: string | null
          item_comment?: string | null
          made_by?: string | null
          order_id?: string
          product?: string
          production_status?: string | null
          reference_images?: string[]
          ribbon_color?: string | null
          shape?: string | null
          size?: string | null
          text_color?: string | null
          text_style?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          birth_date: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          newsletter_subscription: boolean | null
          phone: string | null
          reward_balance: number | null
          updated_at: string
          welcome_discount_available: boolean | null
          welcome_discount_expires_at: string | null
          welcome_discount_reserved_at: string | null
          welcome_discount_reserved_order_id: string | null
          welcome_discount_used_at: string | null
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          newsletter_subscription?: boolean | null
          phone?: string | null
          reward_balance?: number | null
          updated_at?: string
          welcome_discount_available?: boolean | null
          welcome_discount_expires_at?: string | null
          welcome_discount_reserved_at?: string | null
          welcome_discount_reserved_order_id?: string | null
          welcome_discount_used_at?: string | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          newsletter_subscription?: boolean | null
          phone?: string | null
          reward_balance?: number | null
          updated_at?: string
          welcome_discount_available?: boolean | null
          welcome_discount_expires_at?: string | null
          welcome_discount_reserved_at?: string | null
          welcome_discount_reserved_order_id?: string | null
          welcome_discount_used_at?: string | null
        }
        Relationships: []
      }
      reward_transactions: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          expires_at: string | null
          id: string
          note: string | null
          order_id: string | null
          type: "earned" | "spent" | "expired" | "adjustment"
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          expires_at?: string | null
          id?: string
          note?: string | null
          order_id?: string | null
          type: "earned" | "spent" | "expired" | "adjustment"
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          expires_at?: string | null
          id?: string
          note?: string | null
          order_id?: string | null
          type?: "earned" | "spent" | "expired" | "adjustment"
        }
        Relationships: [
          {
            foreignKeyName: "reward_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_fully_booked_dates: {
        Args: never
        Returns: {
          booked_date: string
        }[]
      }
      get_order_count_for_date: {
        Args: { target_date: string }
        Returns: number
      }
      get_order_validation: {
        Args: { target_order_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
