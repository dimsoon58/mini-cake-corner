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
          newsletter_subscription: boolean
          order_comment: string | null
          order_number: string | null
          order_source: string
          order_validation: Database["public"]["Enums"]["order_validation_status"]
          paid_at: string | null
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          phone: string
          pickup_delivery_datetime: string
          postfinance_transaction_id: string | null
          total_amount: number
        }
        Insert: {
          created_at?: string
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
          newsletter_subscription?: boolean
          order_comment?: string | null
          order_number?: string | null
          order_source?: string
          order_validation?: Database["public"]["Enums"]["order_validation_status"]
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          phone: string
          pickup_delivery_datetime: string
          postfinance_transaction_id?: string | null
          total_amount: number
        }
        Update: {
          created_at?: string
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
          newsletter_subscription?: boolean
          order_comment?: string | null
          order_number?: string | null
          order_source?: string
          order_validation?: Database["public"]["Enums"]["order_validation_status"]
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          phone?: string
          pickup_delivery_datetime?: string
          postfinance_transaction_id?: string | null
          total_amount?: number
        }
        Relationships: []
      }
      order_items: {
        Row: {
          assigned_to: string | null
          base_color: string | null
          butterfly_color: string | null
          cake_text: string | null
          candles: Json
          candles_price: number
          created_at: string
          decoration_color: string | null
          design: string | null
          extras: string[]
          extras_price: number
          flavors: string[]
          id: string
          internal_notes: string | null
          item_comment: string | null
          made_by: string | null
          order_id: string
          product: Database["public"]["Enums"]["product_type"]
          production_status: Database["public"]["Enums"]["production_status"]
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
          candles?: Json
          candles_price?: number
          created_at?: string
          decoration_color?: string | null
          design?: string | null
          extras?: string[]
          extras_price?: number
          flavors?: string[]
          id?: string
          internal_notes?: string | null
          item_comment?: string | null
          made_by?: string | null
          order_id: string
          product: Database["public"]["Enums"]["product_type"]
          production_status?: Database["public"]["Enums"]["production_status"]
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
          candles?: Json
          candles_price?: number
          created_at?: string
          decoration_color?: string | null
          design?: string | null
          extras?: string[]
          extras_price?: number
          flavors?: string[]
          id?: string
          internal_notes?: string | null
          item_comment?: string | null
          made_by?: string | null
          order_id?: string
          product?: Database["public"]["Enums"]["product_type"]
          production_status?: Database["public"]["Enums"]["production_status"]
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
    }
    Enums: {
      order_validation_status: "pending" | "approved" | "rejected"
      payment_status: "pending" | "paid" | "failed" | "cancelled" | "refunded"
      product_type:
        | "bento_cake"
        | "rectangle_cake"
        | "dot_cakes"
        | "diy_kit"
        | "candles"
        | "edible_printing"
      production_status:
        | "to_assign"
        | "to_prepare"
        | "in_progress"
        | "completed"
        | "ready_for_pickup"
        | "delivered"
        | "picked_up"
        | "cancelled"
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
    Enums: {
      order_validation_status: ["pending", "approved", "rejected"],
      payment_status: ["pending", "paid", "failed", "cancelled", "refunded"],
      product_type: [
        "bento_cake",
        "rectangle_cake",
        "dot_cakes",
        "diy_kit",
        "candles",
        "edible_printing",
      ],
      production_status: [
        "to_assign",
        "to_prepare",
        "in_progress",
        "completed",
        "ready_for_pickup",
        "delivered",
        "picked_up",
        "cancelled",
      ],
    },
  },
} as const
