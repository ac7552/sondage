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
  end

  # Interview and safety scripts, under a path that changes when they change
  get "sondage/v/:v/*path" => "sondage_scripts#show", format: false, as: :sondage_script

  # The page a safety-copy holder opens from their safety email
  get "safety" => "safety#show", as: :safety
  post "safety/lookup" => "safety#lookup"
  post "safety/approve" => "safety#approve"
  post "safety/deny" => "safety#deny"
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
      post "interviews/:id/capsule" => "capsules#create", as: :interview_capsule
      resources :recoveries, only: %i[create show] do
        post :complete, on: :member
      end
    end
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
