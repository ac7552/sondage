Rails.application.routes.draw do
  devise_for :users, path: "", path_names: { sign_in: "sign-in", sign_out: "sign-out" }
  root "dashboard#show"

  get "download" => "downloads#show", as: :download
  resource :signing_key, only: :update # the historian's browser registers its public key

  resources :intake_questions, except: :show
  namespace :admin do
    resources :fellows, only: %i[new create]
  end

  resources :fellows, only: :show do
    patch :stage, on: :member
    patch :historian, on: :member, action: :assign_historian
    resource :intake, only: %i[show update] do
      post :complete
    end
    resource :ten_by_ten, only: %i[show update] do
      post :complete
    end
    resources :eras, except: %i[index show]
    resources :events, except: %i[index show]
    resources :items, except: %i[index show]
    resource :timeline, only: :show
    resources :timeline_versions, only: %i[index create]
    resources :meetings, only: %i[new create]
    resources :journal_entries, path: "journal", except: %i[show new] do
      get :voice, on: :member
    end
    resources :journal_prompts, only: %i[create destroy]
  end

  # Matching Fellows and historians
  get "match" => "matches#show", as: :match
  patch "match/intro" => "matches#update_intro", as: :match_intro
  get "match/profile" => "matches#edit_profile", as: :edit_historian_profile
  patch "match/profile" => "matches#update_profile", as: :match_profile
  post "match/choose" => "matches#choose", as: :match_choose
  post "match/:id/confirm" => "matches#confirm", as: :confirm_match
  post "match/:id/decline" => "matches#decline", as: :decline_match

  # Interview and safety scripts, under a path that changes when they change
  get "sondage/v/:v/*path" => "sondage_scripts#show", format: false, as: :sondage_script

  # The page a safety-copy holder opens from their safety email
  get "safety" => "safety#show", as: :safety
  post "safety/lookup" => "safety#lookup"
  post "safety/approve" => "safety#approve"
  post "safety/deny" => "safety#deny"
  post "safety/report_death" => "safety#report_death"
  resources :inheritance_claims, only: [] do
    member do
      patch :confirm
      patch :refuse
    end
  end
  resources :recoveries, only: [] do
    member do
      patch :release
      patch :cancel
    end
  end

  resources :meetings, only: %i[show update] do
    get :room, on: :member
  end

  # Used by the Fellow's desktop app
  namespace :api do
    namespace :v1 do
      resource :session, only: %i[create destroy]
      get "me" => "me#show"
      put "keys" => "keys#update"
      get "fellow/timeline" => "timelines#show"
      resources :journal, controller: "journal", only: %i[index create update destroy] do
        get :voice, on: :member
        post "prompts/:prompt_id/dismiss" => "journal#dismiss_prompt", on: :collection, as: :dismiss_prompt
      end
      get "historians" => "historians#index"
      post "historians/:id/choose" => "historians#choose", as: :choose_historian
      delete "historians/:id/choose" => "historians#unchoose"
      patch "match_intro" => "historians#update_intro"
      put "heirs" => "heirs#update"
      resources :inheritances, only: :index do
        member do
          post :recovery, action: :create_recovery
          get "recovery/:recovery_id" => "inheritances#recovery", as: :recovery_status
          post "recovery/:recovery_id/complete" => "inheritances#complete", as: :recovery_complete
        end
      end
      post "interviews/:id/capsule" => "capsules#create", as: :interview_capsule
      resources :recoveries, only: %i[create show] do
        post :complete, on: :member
      end
    end
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
