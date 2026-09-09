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
      events: {
        Row: {
          actor: string | null
          confidence: Database["public"]["Enums"]["event_confidence"]
          created_at: string
          id: string
          kind: string
          lat: number | null
          lon: number | null
          severity: number | null
          source_id: string | null
          source_url: string | null
          summary: string | null
          tags: string[]
          title: string
          ts: string
          updated_at: string
        }
        Insert: {
          actor?: string | null
          confidence?: Database["public"]["Enums"]["event_confidence"]
          created_at?: string
          id?: string
          kind: string
          lat?: number | null
          lon?: number | null
          severity?: number | null
          source_id?: string | null
          source_url?: string | null
          summary?: string | null
          tags?: string[]
          title: string
          ts: string
          updated_at?: string
        }
        Update: {
          actor?: string | null
          confidence?: Database["public"]["Enums"]["event_confidence"]
          created_at?: string
          id?: string
          kind?: string
          lat?: number | null
          lon?: number | null
          severity?: number | null
          source_id?: string | null
          source_url?: string | null
          summary?: string | null
          tags?: string[]
          title?: string
          ts?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          anon_id: string | null
          id: number
          kind: string
          meta: Json
          report_slug: string | null
          ts: string
        }
        Insert: {
          anon_id?: string | null
          id?: never
          kind: string
          meta?: Json
          report_slug?: string | null
          ts?: string
        }
        Update: {
          anon_id?: string | null
          id?: never
          kind?: string
          meta?: Json
          report_slug?: string | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactions_anon_id_fkey"
            columns: ["anon_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["anon_id"]
          },
        ]
      }
      report_blocks: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["block_kind"]
          ord: number
          payload: Json
          report_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["block_kind"]
          ord: number
          payload?: Json
          report_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["block_kind"]
          ord?: number
          payload?: Json
          report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_blocks_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_revisions: {
        Row: {
          created_at: string
          created_by: string | null
          id: number
          note: string | null
          report_id: string
          snapshot: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: never
          note?: string | null
          report_id: string
          snapshot: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: never
          note?: string | null
          report_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "report_revisions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          author: string | null
          created_at: string
          dek: string | null
          hero: Json
          id: string
          kicker: string | null
          og_image: string | null
          portal_url: string | null
          published_at: string | null
          read_minutes: number | null
          region: string | null
          seo: Json
          slug: string
          status: Database["public"]["Enums"]["report_status"]
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author?: string | null
          created_at?: string
          dek?: string | null
          hero?: Json
          id?: string
          kicker?: string | null
          og_image?: string | null
          portal_url?: string | null
          published_at?: string | null
          read_minutes?: number | null
          region?: string | null
          seo?: Json
          slug: string
          status?: Database["public"]["Enums"]["report_status"]
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author?: string | null
          created_at?: string
          dek?: string | null
          hero?: Json
          id?: string
          kicker?: string | null
          og_image?: string | null
          portal_url?: string | null
          published_at?: string | null
          read_minutes?: number | null
          region?: string | null
          seo?: Json
          slug?: string
          status?: Database["public"]["Enums"]["report_status"]
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      series: {
        Row: {
          created_at: string
          frequency: Database["public"]["Enums"]["series_frequency"] | null
          id: string
          key: string
          name: string
          notes: string | null
          source_id: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          frequency?: Database["public"]["Enums"]["series_frequency"] | null
          id?: string
          key: string
          name: string
          notes?: string | null
          source_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          frequency?: Database["public"]["Enums"]["series_frequency"] | null
          id?: string
          key?: string
          name?: string
          notes?: string | null
          source_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      series_points: {
        Row: {
          series_id: string
          ts: string
          value: number | null
        }
        Insert: {
          series_id: string
          ts: string
          value?: number | null
        }
        Update: {
          series_id?: string
          ts?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "series_points_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          created_at: string
          id: string
          is_indicative: boolean
          key: string
          licence: string | null
          name: string
          notes: string | null
          publisher: string | null
          retrieved_at: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_indicative?: boolean
          key: string
          licence?: string | null
          name: string
          notes?: string | null
          publisher?: string | null
          retrieved_at?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_indicative?: boolean
          key?: string
          licence?: string | null
          name?: string
          notes?: string | null
          publisher?: string | null
          retrieved_at?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      staff: {
        Row: {
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      subscribers: {
        Row: {
          anon_id: string | null
          consent: boolean
          created_at: string
          email: string
          id: string
          source_report: string | null
          unsubscribed_at: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          verified: boolean
          verified_at: string | null
        }
        Insert: {
          anon_id?: string | null
          consent?: boolean
          created_at?: string
          email: string
          id?: string
          source_report?: string | null
          unsubscribed_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          verified?: boolean
          verified_at?: string | null
        }
        Update: {
          anon_id?: string | null
          consent?: boolean
          created_at?: string
          email?: string
          id?: string
          source_report?: string | null
          unsubscribed_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          verified?: boolean
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscribers_anon_id_fkey"
            columns: ["anon_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["anon_id"]
          },
        ]
      }
      visitors: {
        Row: {
          anon_id: string
          country: string | null
          device: Database["public"]["Enums"]["device_class"] | null
          first_seen: string
          last_seen: string
          referrer: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          anon_id: string
          country?: string | null
          device?: Database["public"]["Enums"]["device_class"] | null
          first_seen?: string
          last_seen?: string
          referrer?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          anon_id?: string
          country?: string | null
          device?: Database["public"]["Enums"]["device_class"] | null
          first_seen?: string
          last_seen?: string
          referrer?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      block_kind:
        | "prose"
        | "kpi_row"
        | "chart"
        | "timeline"
        | "map"
        | "table"
        | "callout"
        | "quote"
        | "sourcebox"
        | "cta"
        | "embed"
      device_class: "phone" | "tablet" | "desktop" | "other"
      event_confidence: "confirmed" | "reported" | "unconfirmed"
      report_status: "draft" | "scheduled" | "published" | "archived"
      series_frequency:
        | "daily"
        | "weekly"
        | "monthly"
        | "quarterly"
        | "annual"
        | "irregular"
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
      block_kind: [
        "prose",
        "kpi_row",
        "chart",
        "timeline",
        "map",
        "table",
        "callout",
        "quote",
        "sourcebox",
        "cta",
        "embed",
      ],
      device_class: ["phone", "tablet", "desktop", "other"],
      event_confidence: ["confirmed", "reported", "unconfirmed"],
      report_status: ["draft", "scheduled", "published", "archived"],
      series_frequency: [
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "annual",
        "irregular",
      ],
    },
  },
} as const
